// generate-token.js
const { google } = require('googleapis');
const readline = require('readline');
const fs = require('fs');
require('dotenv').config();

// Configuration OAuth2
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/oauth2callback'
);

const scopes = ['https://www.googleapis.com/auth/drive'];

// Générer l'URL d'autorisation
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: scopes,
  prompt: 'consent'
});

console.log('🔗 Ouvrez cette URL dans votre navigateur:');
console.log(authUrl);
console.log('\n📋 Après autorisation, copiez le code de l\'URL et collez-le ici:');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Code: ', async (code) => {
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('\n✅ Tokens obtenus!');
    console.log('\n📝 Ajoutez cette ligne dans votre .env:');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    
    // Sauvegarder dans un fichier
    fs.writeFileSync('tokens.json', JSON.stringify(tokens, null, 2));
    console.log('\n✅ Tokens sauvegardés dans tokens.json');
  } catch (error) {
    console.error('❌ Erreur:', error.message);
  }
  rl.close();
});