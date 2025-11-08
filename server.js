// server.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const uploadRoute = require('./routes/uploads');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api', uploadRoute);

// Route de test
app.get('/', (req, res) => {
  res.json({ message: 'API de upload de fichiers - Serveur actif ✅' });
});

// Gestion des erreurs
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Une erreur est survenue sur le serveur' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
  console.log(`📁 API upload disponible sur http://localhost:${PORT}/api/upload-and-send`);
});

module.exports = app;