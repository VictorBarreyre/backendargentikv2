// routes/upload.js
const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Configuration de Multer pour l'upload temporaire
const upload = multer({ 
  dest: 'temp/',
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max par fichier
});

// Configuration Google Drive API
const auth = new google.auth.GoogleAuth({
  keyFile: 'credentials.json', // Votre fichier de credentials
  scopes: ['https://www.googleapis.com/auth/drive.file']
});

const drive = google.drive({ version: 'v3', auth });

// Configuration Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail', // ou un autre service
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Fonction pour créer un dossier dans Google Drive
async function createFolder(folderName, parentFolderId) {
  try {
    const fileMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentFolderId ? [parentFolderId] : []
    };

    const folder = await drive.files.create({
      requestBody: fileMetadata,
      fields: 'id, name'
    });

    return folder.data.id;
  } catch (error) {
    console.error('Erreur création dossier:', error);
    throw error;
  }
}

// Fonction pour uploader un fichier dans Google Drive
async function uploadFileToDrive(filePath, fileName, folderId) {
  try {
    const fileMetadata = {
      name: fileName,
      parents: [folderId]
    };

    const media = {
      mimeType: 'application/octet-stream',
      body: fs.createReadStream(filePath)
    };

    const file = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink'
    });

    return file.data;
  } catch (error) {
    console.error('Erreur upload fichier:', error);
    throw error;
  }
}

// Fonction pour envoyer l'email
async function sendEmail(userEmail, nom, prenom, filesLinks) {
  const filesList = filesLinks.map(f => `- ${f.name}: ${f.webViewLink}`).join('\n');

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: userEmail,
    subject: 'Confirmation de réception de vos fichiers',
    text: `Bonjour ${prenom} ${nom},\n\nNous avons bien reçu vos fichiers :\n\n${filesList}\n\nCordialement,\nL'équipe`,
    html: `
      <h2>Bonjour ${prenom} ${nom},</h2>
      <p>Nous avons bien reçu vos fichiers :</p>
      <ul>
        ${filesLinks.map(f => `<li><a href="${f.webViewLink}">${f.name}</a></li>`).join('')}
      </ul>
      <p>Cordialement,<br>L'équipe</p>
    `
  };

  await transporter.sendMail(mailOptions);
}

// Route principale
router.post('/api/upload-and-send', upload.array('files'), async (req, res) => {
  try {
    const { nom, prenom, email, message } = req.body;
    const files = req.files;

    if (!nom || !prenom || !email || !files || files.length === 0) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    // 1. Créer le dossier avec le nom complet
    const folderName = `${prenom}_${nom}`;
    const PARENT_FOLDER_ID = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID; // ID du dossier parent
    const folderId = await createFolder(folderName, PARENT_FOLDER_ID);

    // 2. Upload des fichiers dans le dossier
    const uploadedFiles = [];
    for (const file of files) {
      const uploadedFile = await uploadFileToDrive(
        file.path,
        file.originalname,
        folderId
      );
      uploadedFiles.push(uploadedFile);

      // Supprimer le fichier temporaire
      fs.unlinkSync(file.path);
    }

    // 3. Envoyer l'email de confirmation
    await sendEmail(email, nom, prenom, uploadedFiles);

    // 4. Envoyer une notification interne (optionnel)
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL,
      subject: `Nouveaux fichiers de ${prenom} ${nom}`,
      text: `${prenom} ${nom} (${email}) a uploadé ${files.length} fichier(s).\n\nMessage: ${message || 'Aucun'}`
    });

    res.json({
      success: true,
      message: 'Fichiers uploadés avec succès',
      folderId,
      files: uploadedFiles
    });

  } catch (error) {
    console.error('Erreur:', error);
    
    // Nettoyer les fichiers temporaires en cas d'erreur
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }

    res.status(500).json({ 
      error: 'Erreur lors du traitement',
      details: error.message 
    });
  }
});

module.exports = router;