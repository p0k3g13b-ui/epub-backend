const axios = require('axios');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

// Initialisation Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

/**
 * Recherche des livres sur Anna's Archive
 */
async function searchBooks(query) {
  try {
    const searchUrl = `https://fr.annas-archive.org/search?index=&page=1&sort=&ext=epub&display=&q=${encodeURIComponent(query)}`;
    
    console.log(`🌐 URL de recherche: ${searchUrl}`);
    
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    
    const $ = cheerio.load(response.data);
    const results = [];
    
    // Cherche les résultats (adapte les sélecteurs selon la structure HTML réelle)
    $('a[href*="/md5/"]').each((i, element) => {
      const $elem = $(element);
      const href = $elem.attr('href');
      
      // Extrait les métadonnées depuis la structure HTML
      const title = $elem.find('h3, .title').first().text().trim() || 
                    $elem.text().trim().split('\n')[0];
      
      // Cherche l'auteur (souvent dans un élément proche)
      const author = $elem.find('.author, .italic').first().text().trim() ||
                     $elem.parent().find('.author').first().text().trim();
      
      // Cherche d'autres infos
      const year = $elem.find('.year').text().trim() || '';
      const language = $elem.find('.language').text().trim() || '';
      const fileSize = $elem.find('.size').text().trim() || '';
      
      if (title && href) {
        results.push({
          title: title.substring(0, 200), // Limite la longueur
          author: author || 'Auteur inconnu',
          year: year,
          language: language || 'fr',
          fileSize: fileSize,
          bookUrl: href.startsWith('http') ? href : `https://fr.annas-archive.org${href}`,
          source: 'annas-archive'
        });
      }
    });
    
    console.log(`📚 ${results.length} résultats parsés`);
    
    return results.slice(0, 20); // Limite à 20 résultats
    
  } catch (error) {
    console.error('Erreur lors de la recherche:', error.message);
    throw new Error(`Search failed: ${error.message}`);
  }
}

/**
 * Ajoute un livre à la bibliothèque
 */
async function addBook(bookUrl, metadata) {
  try {
    console.log(`📖 Traitement: ${bookUrl}`);
    
    // 1. Récupère la page du livre
    const bookPage = await axios.get(bookUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    
    const $ = cheerio.load(bookPage.data);
    
    // 2. Trouve tous les liens de téléchargement
    const downloadLinks = [];
    $('a[href*="download"]').each((i, elem) => {
      const href = $(elem).attr('href');
      if (href && !href.includes('donate') && !href.includes('premium')) {
        downloadLinks.push(href.startsWith('http') ? href : `https://fr.annas-archive.org${href}`);
      }
    });
    
    if (downloadLinks.length === 0) {
      throw new Error('Aucun lien de téléchargement trouvé');
    }
    
    // 3. Prend le dernier lien (généralement le gratuit)
    const lastLink = downloadLinks[downloadLinks.length - 1];
    console.log(`🔗 Dernier lien trouvé: ${lastLink}`);
    
    // 4. Suit la redirection pour obtenir le vrai lien de téléchargement
    const redirectPage = await axios.get(lastLink, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    
    const $redirect = cheerio.load(redirectPage.data);
    
    // Cherche le bouton/lien de téléchargement final
    let finalDownloadUrl = null;
    $redirect('a').each((i, elem) => {
      const href = $redirect(elem).attr('href');
      const text = $redirect(elem).text().toLowerCase();
      if (href && (text.includes('download') || text.includes('télécharger') || href.includes('.epub'))) {
        finalDownloadUrl = href.startsWith('http') ? href : `https://fr.annas-archive.org${href}`;
      }
    });
    
    if (!finalDownloadUrl) {
      // Fallback : utilise le dernier lien directement
      finalDownloadUrl = lastLink;
    }
    
    console.log(`⬇️ Téléchargement depuis: ${finalDownloadUrl}`);
    
    // 5. Télécharge le fichier EPUB
    const epubResponse = await axios.get(finalDownloadUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 60000, // 60 secondes pour le téléchargement
      maxContentLength: 50 * 1024 * 1024 // Max 50MB
    });
    
    const epubBuffer = Buffer.from(epubResponse.data);
    console.log(`✅ EPUB téléchargé: ${(epubBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    
    // 6. Génère un nom de fichier unique
    const sanitizedTitle = (metadata?.title || 'book')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 50);
    const filename = `${sanitizedTitle}-${Date.now()}.epub`;
    
    // 7. Vérifie les doublons (par titre similaire ou filename)
    const { data: existingBooks } = await supabase
      .from('books')
      .select('filename, title')
      .ilike('title', `%${metadata?.title || ''}%`);
    
    if (existingBooks && existingBooks.length > 0) {
      return {
        success: false,
        message: 'Livre déjà dans la bibliothèque',
        existing: existingBooks[0]
      };
    }
    
    // 8. Upload sur Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('epubs')
      .upload(filename, epubBuffer, {
        contentType: 'application/epub+zip',
        upsert: false
      });
    
    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }
    
    console.log(`☁️ Uploadé sur Supabase: ${filename}`);
    
    // 9. Récupère l'URL publique
    const { data: urlData } = supabase.storage
      .from('epubs')
      .getPublicUrl(filename);
    
    // 10. Crée l'entrée dans la table books
    const { data: bookData, error: bookError } = await supabase
      .from('books')
      .insert({
        title: metadata?.title || 'Sans titre',
        author: metadata?.author || null,
        filename: filename,
        cover_url: null, // À compléter manuellement plus tard
        file_size: epubBuffer.length,
        language: metadata?.language || null,
        year: metadata?.year ? parseInt(metadata.year) : null
      })
      .select()
      .single();
    
    if (bookError) {
      // Supprime le fichier uploadé si l'insertion échoue
      await supabase.storage.from('epubs').remove([filename]);
      throw new Error(`Database insert failed: ${bookError.message}`);
    }
    
    console.log(`✅ Livre ajouté à la base: ${bookData.title}`);
    
    return {
      success: true,
      message: 'Livre ajouté avec succès',
      book: bookData
    };
    
  } catch (error) {
    console.error('Erreur lors de l\'ajout:', error.message);
    throw error;
  }
}

/**
 * Ajoute un livre à la bibliothèque depuis une URL de téléchargement direct
 */
async function addBookFromUrl(downloadUrl, metadata) {
  try {
    console.log(`📥 Téléchargement depuis: ${downloadUrl}`);
    
    // 1. Télécharge le fichier depuis l'URL fournie
    const epubResponse = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 60000, // 60 secondes
      maxContentLength: 50 * 1024 * 1024, // Max 50MB
      maxRedirects: 5
    });
    
    // 2. Vérifie le Content-Type
    const contentType = epubResponse.headers['content-type'];
    console.log(`📄 Content-Type: ${contentType}`);
    
    if (contentType && contentType.includes('text/html')) {
      throw new Error('Le lien fourni mène vers une page HTML, pas un fichier EPUB. Vérifiez que vous avez copié le bon lien de téléchargement.');
    }
    
    const epubBuffer = Buffer.from(epubResponse.data);
    console.log(`✅ EPUB téléchargé: ${(epubBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    
    // 3. Vérifie que c'est un fichier ZIP (EPUB = ZIP)
    const fileSignature = epubBuffer.toString('hex', 0, 4);
    if (fileSignature !== '504b0304') { // Signature ZIP : PK..
      throw new Error('Le fichier téléchargé n\'est pas un EPUB valide (signature ZIP manquante).');
    }
    
    // 4. Génère un nom de fichier unique
    const sanitizedTitle = (metadata?.title || 'book')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 50);
    const filename = `${sanitizedTitle}-${Date.now()}.epub`;
    
    // 5. Vérifie les doublons
    const { data: existingBooks } = await supabase
      .from('books')
      .select('filename, title')
      .ilike('title', `%${metadata?.title || ''}%`);
    
    if (existingBooks && existingBooks.length > 0) {
      return {
        success: false,
        message: 'Livre déjà dans la bibliothèque',
        existing: existingBooks[0]
      };
    }
    
    // 6. Upload sur Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('epubs')
      .upload(filename, epubBuffer, {
        contentType: 'application/epub+zip',
        upsert: false
      });
    
    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }
    
    console.log(`☁️ Uploadé sur Supabase: ${filename}`);
    
    // 7. Crée l'entrée dans la table books
    const { data: bookData, error: bookError } = await supabase
      .from('books')
      .insert({
        title: metadata?.title || 'Sans titre',
        author: metadata?.author || null,
        filename: filename,
        cover_url: null,
        file_size: epubBuffer.length,
        language: metadata?.language || null,
        year: metadata?.year ? parseInt(metadata.year) : null
      })
      .select()
      .single();
    
    if (bookError) {
      // Supprime le fichier uploadé si l'insertion échoue
      await supabase.storage.from('epubs').remove([filename]);
      throw new Error(`Database insert failed: ${bookError.message}`);
    }
    
    console.log(`✅ Livre ajouté à la base: ${bookData.title}`);
    
    return {
      success: true,
      message: 'Livre ajouté avec succès',
      book: bookData
    };
    
  } catch (error) {
    console.error('Erreur lors de l\'ajout depuis URL:', error.message);
    throw error;
  }
}

module.exports = {
  searchBooks,
  addBook,
  addBookFromUrl
};
