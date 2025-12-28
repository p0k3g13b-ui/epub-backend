require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { searchBooks, addBook } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Gestion des erreurs 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`🚀 Backend démarré sur le port ${PORT}`);
  console.log(`📡 Frontend autorisé: ${process.env.FRONTEND_URL || '*'}`);
});
