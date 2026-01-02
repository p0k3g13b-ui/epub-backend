require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Resend } = require('resend');
const { searchBooks, addBook, addBookFromUrl } = require('./scraper');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialisation Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Initialisation Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Email de l'administrateur
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'p0k3g13b@gmail.com';

// Middleware
app.use(cors({
origin: process.env.FRONTEND_URL || '*', // À configurer pour ton GitHub Pages
credentials: true
}));
app.use(express.json());

// Route de test
app.get('/', (req, res) => {
res.json({ 
status: 'ok', 
message: 'EPUB Backend API',
endpoints: {
search: 'POST /api/search',
addBook: 'POST /api/add-book',
health: 'GET /api/health'
}
});
});

// Health check
app.get('/api/health', (req, res) => {
res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Endpoint de recherche
app.post('/api/search', async (req, res) => {
try {
const { query } = req.body;

if (!query || query.trim() === '') {
return res.status(400).json({ 
error: 'Query parameter is required' 
});
}

console.log(`🔍 Recherche: "${query}"`);

const results = await searchBooks(query);

console.log(`✅ ${results.length} résultats trouvés`);

res.json({ 
success: true, 
results,
count: results.length 
});

} catch (error) {
console.error('❌ Erreur recherche:', error);
res.status(500).json({ 
error: 'Search failed', 
message: error.message 
});
}
});

// Endpoint d'ajout de livre
app.post('/api/add-book', async (req, res) => {
try {
const { bookUrl, metadata } = req.body;

if (!bookUrl) {
return res.status(400).json({ 
error: 'bookUrl is required' 
});
}

console.log(`📥 Ajout du livre: ${metadata?.title || 'Sans titre'}`);

const result = await addBook(bookUrl, metadata);

if (result.success) {
console.log(`✅ Livre ajouté: ${result.book.title}`);
res.json(result);
} else {
console.log(`⚠️ ${result.message}`);
res.status(409).json(result); // 409 Conflict pour doublon
}

} catch (error) {
console.error('❌ Erreur ajout:', error);
res.status(500).json({ 
error: 'Failed to add book', 
message: error.message 
});
}
});

// Endpoint d'ajout de livre depuis URL
app.post('/api/add-book-from-url', async (req, res) => {
try {
const { downloadUrl, metadata, userId } = req.body;

if (!downloadUrl) {
return res.status(400).json({ 
error: 'downloadUrl is required' 
});
}

if (!userId) {
return res.status(400).json({ 
error: 'userId is required' 
});
}

console.log(`📥 Ajout depuis URL: ${metadata?.title || 'Sans titre'}`);
console.log(`🔗 URL: ${downloadUrl}`);
console.log(`👤 User: ${userId}`);

const result = await addBookFromUrl(downloadUrl, metadata, userId);

if (result.success) {
console.log(`✅ Livre ajouté pour l'utilisateur ${userId}`);
res.json(result);
} else {
console.log(`⚠️ ${result.message}`);
res.status(409).json(result); // 409 Conflict si déjà dans la biblio
}

} catch (error) {
console.error('❌ Erreur ajout depuis URL:', error);
res.status(500).json({ 
error: 'Failed to add book from URL', 
message: error.message 
});
}
});

// Endpoint de notification admin (nouvelle inscription)
app.post('/api/notify-admin', async (req, res) => {
try {
const { userId, username, email } = req.body;

if (!userId || !username || !email) {
return res.status(400).json({ 
error: 'userId, username, and email are required' 
});
}

console.log(`📧 Notification admin pour: ${username} (${email})`);

// Génère un token d'approbation unique
const approvalToken = require('crypto').randomBytes(32).toString('hex');

// Sauvegarde le token dans la base
const { error: updateError } = await supabase
.from('users')
.update({ approval_token: approvalToken })
.eq('id', userId);

if (updateError) {
console.error('Erreur sauvegarde token:', updateError);
return res.status(500).json({ 
error: 'Failed to save approval token' 
});
}

// URL de base du frontend
const frontendUrl = process.env.FRONTEND_URL || 'https://p0k3g13b-ui.github.io/epub';

// Envoie l'email à l'admin
const { data: emailData, error: emailError } = await resend.emails.send({
from: 'EpubReader <onboarding@resend.dev>',
to: [ADMIN_EMAIL],
subject: '🔔 Nouvelle inscription sur EpubReader',
html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
<h2 style="color: #2d3436;">Nouvelle inscription sur EpubReader</h2>

<div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
<p style="margin: 10px 0;"><strong>👤 Nom d'utilisateur :</strong> ${username}</p>
<p style="margin: 10px 0;"><strong>📧 Email :</strong> ${email}</p>
<p style="margin: 10px 0;"><strong>📅 Date d'inscription :</strong> ${new Date().toLocaleString('fr-FR')}</p>
</div>

<div style="margin: 30px 0; text-align: center;">
<a href="${frontendUrl}/api/approve-user/${approvalToken}" 
style="display: inline-block; padding: 14px 30px; background: #27ae60; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin-right: 10px;">
✅ Approuver
</a>
<a href="${frontendUrl}/api/reject-user/${approvalToken}" 
style="display: inline-block; padding: 14px 30px; background: #e74c3c; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
❌ Rejeter
</a>
</div>

<p style="color: #636e72; font-size: 12px; margin-top: 30px;">
Ce lien ne expire jamais. Vous pouvez approuver ou rejeter cette inscription à tout moment.
</p>
</div>
`
});

if (emailError) {
console.error('❌ Erreur envoi email admin:', emailError);
return res.status(500).json({ 
error: 'Failed to send admin email',
details: emailError 
});
}

console.log('✅ Email admin envoyé:', emailData);

res.json({ 
success: true, 
message: 'Admin notification sent',
emailId: emailData?.id 
});

} catch (error) {
console.error('❌ Erreur notify-admin:', error);
res.status(500).json({ 
error: 'Failed to notify admin', 
message: error.message 
});
}
});

// Endpoint d'approbation
app.get('/api/approve-user/:token', async (req, res) => {
try {
const { token } = req.params;

console.log(`✅ Tentative d'approbation avec token: ${token}`);

// Trouve l'utilisateur
const { data: user, error: findError } = await supabase
.from('users')
.select('*')
.eq('approval_token', token)
.single();

if (findError || !user) {
return res.status(404).send(`
<html>
<head><title>Erreur</title></head>
<body style="font-family: Arial; text-align: center; padding: 50px;">
<h1>❌ Lien invalide</h1>
<p>Ce lien d'approbation n'existe pas ou a déjà été utilisé.</p>
</body>
</html>
`);
}

// Vérifie si déjà approuvé ou rejeté
if (user.approved) {
return res.send(`
<html>
<head><title>Déjà approuvé</title></head>
<body style="font-family: Arial; text-align: center; padding: 50px;">
<h1>ℹ️ Déjà approuvé</h1>
<p>L'utilisateur <strong>${user.username}</strong> a déjà été approuvé le ${new Date(user.approved_at).toLocaleString('fr-FR')}.</p>
</body>
</html>
`);
}

if (user.rejected) {
return res.send(`
<html>
<head><title>Déjà rejeté</title></head>
<body style="font-family: Arial; text-align: center; padding: 50px;">
<h1>ℹ️ Déjà rejeté</h1>
<p>L'utilisateur <strong>${user.username}</strong> a déjà été rejeté le ${new Date(user.rejected_at).toLocaleString('fr-FR')}.</p>
</body>
</html>
`);
}

// Approuve l'utilisateur
const { error: updateError } = await supabase
.from('users')
.update({ 
approved: true,
approved_at: new Date().toISOString()
})
.eq('id', user.id);

if (updateError) {
console.error('Erreur approbation:', updateError);
return res.status(500).send(`
<html>
<head><title>Erreur</title></head>
<body style="font-family: Arial; text-align: center; padding: 50px;">
<h1>❌ Erreur</h1>
<p>Impossible d'approuver l'utilisateur.</p>
</body>
</html>
`);
}

// Envoie un email de confirmation à l'utilisateur
await resend.emails.send({
from: 'EpubReader <onboarding@resend.dev>',
to: [user.email],
subject: '✅ Votre compte EpubReader a été approuvé !',
html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
<h2 style="color: #27ae60;">✅ Compte approuvé !</h2>

<p>Bonjour <strong>${user.username}</strong>,</p>

<p>Votre compte EpubReader a été approuvé par l'administrateur. Vous pouvez maintenant vous connecter et profiter de votre bibliothèque !</p>

<div style="margin: 30px 0; text-align: center;">
<a href="${process.env.FRONTEND_URL || 'https://p0k3g13b-ui.github.io/epub'}/login.html" 
style="display: inline-block; padding: 14px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
Se connecter
</a>
</div>

<p>À bientôt sur EpubReader ! 📚</p>
</div>
`
});

console.log(`✅ Utilisateur approuvé: ${user.username}`);

res.send(`
<html>
<head><title>Utilisateur approuvé</title></head>
<body style="font-family: Arial; text-align: center; padding: 50px;">
<h1 style="color: #27ae60;">✅ Utilisateur approuvé</h1>
<p>L'utilisateur <strong>${user.username}</strong> (${user.email}) a été approuvé avec succès.</p>
<p>Un email de confirmation lui a été envoyé.</p>
</body>
</html>
`);

} catch (error) {
console.error('❌ Erreur approve-user:', error);
res.status(500).send(`
<html>
<head><title>Erreur</title></head>
<body style="font-family: Arial; text-align: center; padding: 50px;">
<h1>❌ Erreur</h1>
<p>Une erreur est survenue.</p>
</body>
</html>
`);
}
});

// Endpoint de rejet
app.get('/api/reject-user/:token', async (req, res) => {
try {
const { token } = req.params;

console.log(`❌ Tentative de rejet avec token: ${token}`);

// Trouve l'utilisateur
const { data: user, error: findError } = await supabase
.from('users')
.select('*')
.eq('approval_token', token)
.single();

if (findError || !user) {
return res.status(404).send(`
<html>
<head><title>Erreur</title></head>
<body style="font-family: Arial; text-align: center; padding: 50px;">
<h1>❌ Lien invalide</h1>
<p>Ce lien de rejet n'existe pas ou a déjà été utilisé.</p>
</body>
</html>
`);
}

// Vérifie si déjà approuvé ou rejeté
if (user.approved) {
return res.send(`
<html>
<head><title>Déjà approuvé</title></head>
<body style="font-family: Arial; text-align: center; padding: 50px;">
<h1>ℹ️ Impossible de rejeter</h1>
<p>L'utilisateur <strong>${user.username}</strong> a déjà été approuvé le ${new Date(user.approved_at).toLocaleString('fr-FR')}.</p>
</body>
</html>
`);
}

if (user.rejected) {
return res.send(`
<html>
<head><title>Déjà rejeté</title></head>
<body style="font-family: Arial; text-align: center; padding: 50px;">
<h1>ℹ️ Déjà rejeté</h1>
<p>L'utilisateur <strong>${user.username}</strong> a déjà été rejeté le ${new Date(user.rejected_at).toLocaleString('fr-FR')}.</p>
</body>
</html>
`);
}

// Rejette l'utilisateur
const { error: updateError } = await supabase
.from('users')
.update({ 
rejected: true,
rejected_at: new Date().toISOString()
})
.eq('id', user.id);

if (updateError) {
console.error('Erreur rejet:', updateError);
return res.status(500).send(`
<html>
<head><title>Erreur</title></head>
<body style="font-family: Arial; text-align: center; padding: 50px;">
<h1>❌ Erreur</h1>
<p>Impossible de rejeter l'utilisateur.</p>
</body>
</html>
`);
}

// Envoie un email de rejet à l'utilisateur
await resend.emails.send({
from: 'EpubReader <onboarding@resend.dev>',
to: [user.email],
subject: 'Votre demande d\'inscription EpubReader',
html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
<h2 style="color: #e74c3c;">Inscription non approuvée</h2>

<p>Bonjour <strong>${user.username}</strong>,</p>

<p>Votre demande d'inscription sur EpubReader n'a pas été approuvée par l'administrateur.</p>

<p>Si vous pensez qu'il s'agit d'une erreur, vous pouvez nous contacter.</p>

<p>Cordialement,<br>L'équipe EpubReader</p>
</div>
`
});

console.log(`❌ Utilisateur rejeté: ${user.username}`);

res.send(`
<html>
<head><title>Utilisateur rejeté</title></head>
<body style="font-family: Arial; text-align: center; padding: 50px;">
<h1 style="color: #e74c3c;">❌ Utilisateur rejeté</h1>
<p>L'utilisateur <strong>${user.username}</strong> (${user.email}) a été rejeté.</p>
<p>Un email de notification lui a été envoyé.</p>
</body>
</html>
`);

} catch (error) {
console.error('❌ Erreur reject-user:', error);
res.status(500).send(`
<html>
<head><title>Erreur</title></head>
<body style="font-family: Arial; text-align: center; padding: 50px;">
<h1>❌ Erreur</h1>
<p>Une erreur est survenue.</p>
</body>
</html>
`);
}
});

// Gestion des erreurs 404
app.use((req, res) => {
res.status(404).json({ error: 'Endpoint not found' });
});

// Démarrage du serveur
app.listen(PORT, () => {
console.log(`🚀 Backend démarré sur le port ${PORT}`);
console.log(`📡 Frontend autorisé: ${process.env.FRONTEND_URL || '*'}`);
});
