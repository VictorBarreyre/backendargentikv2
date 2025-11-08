// routes/uploads.js
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
  keyFile: 'credentials.json',
  scopes: ['https://www.googleapis.com/auth/drive.file']
});

const drive = google.drive({ version: 'v3', auth });

// Configuration Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Fonction pour vérifier si un dossier existe déjà
async function findFolder(folderName, parentFolderId) {
  try {
    const query = `name='${folderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    if (response.data.files && response.data.files.length > 0) {
      return response.data.files[0].id; // Retourne l'ID du premier dossier trouvé
    }
    return null; // Aucun dossier trouvé
  } catch (error) {
    console.error('Erreur recherche dossier:', error);
    return null;
  }
}

// Fonction pour créer un dossier dans Google Drive
async function createFolder(folderName, parentFolderId) {
  try {
    const fileMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId]
    };

    const folder = await drive.files.create({
      requestBody: fileMetadata,
      fields: 'id, name',
      supportsAllDrives: true
    });

    return folder.data.id;
  } catch (error) {
    console.error('Erreur création dossier:', error);
    throw error;
  }
}

// Fonction pour obtenir ou créer un dossier (évite la duplication)
async function getOrCreateFolder(folderName, parentFolderId) {
  console.log(`🔍 Recherche du dossier "${folderName}"...`);

  // Vérifier si le dossier existe déjà
  let folderId = await findFolder(folderName, parentFolderId);

  if (folderId) {
    console.log(`✅ Dossier existant trouvé avec ID: ${folderId}`);
    return folderId;
  }

  // Créer le dossier s'il n'existe pas
  console.log(`📁 Création du nouveau dossier: ${folderName}`);
  folderId = await createFolder(folderName, parentFolderId);
  console.log(`✅ Dossier créé avec ID: ${folderId}`);

  return folderId;
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
      fields: 'id, name, webViewLink',
      supportsAllDrives: true
    });

    return file.data;
  } catch (error) {
    console.error('Erreur upload fichier:', error);
    throw error;
  }
}

// Fonction pour envoyer l'email avec liens Google Drive
async function sendEmail(userEmail, nom, prenom, filesLinks) {
  const filesList = filesLinks.map(f => `- ${f.name}: ${f.webViewLink}`).join('\n');

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: userEmail,
    subject: 'Confirmation de réception de vos fichiers',
    text: `Bonjour ${prenom} ${nom},\n\nNous avons bien reçu vos fichiers :\n\n${filesList}\n\nCordialement,\nL'équipe Argentik`,
    html: `
      <h2>Bonjour ${prenom} ${nom},</h2>
      <p>Nous avons bien reçu vos fichiers :</p>
      <ul>
        ${filesLinks.map(f => `<li><a href="${f.webViewLink}">${f.name}</a></li>`).join('')}
      </ul>
      <p>Cordialement,<br>L'équipe Argentik</p>
    `
  };

  await transporter.sendMail(mailOptions);
}

// Route principale
router.post('/upload-and-send', upload.array('files'), async (req, res) => {
  try {
    console.log('📥 Requête reçue');
    console.log('Body:', req.body);
    console.log('Files:', req.files?.length, 'fichier(s)');

    const { nom, prenom, email, message } = req.body;
    const files = req.files;

    if (!nom || !prenom || !email || !files || files.length === 0) {
      console.log('❌ Validation échouée:', { nom, prenom, email, filesCount: files?.length });
      return res.status(400).json({ error: 'Données manquantes' });
    }

    // 1. Obtenir ou créer le dossier (évite la duplication)
    const folderName = `${prenom}_${nom}`;
    const PARENT_FOLDER_ID = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
    const folderId = await getOrCreateFolder(folderName, PARENT_FOLDER_ID);

    // 2. Upload des fichiers dans le dossier
    const uploadedFiles = [];
    for (const file of files) {
      console.log('📤 Upload du fichier:', file.originalname);
      const uploadedFile = await uploadFileToDrive(
        file.path,
        file.originalname,
        folderId
      );
      uploadedFiles.push(uploadedFile);
      console.log('✅ Fichier uploadé:', uploadedFile.name);

      // Supprimer le fichier temporaire
      fs.unlinkSync(file.path);
    }

    // 3. Envoyer l'email de confirmation
    console.log('📧 Envoi email de confirmation à:', email);
    await sendEmail(email, nom, prenom, uploadedFiles);
    console.log('✅ Email de confirmation envoyé');

    // 4. Envoyer une notification interne
    console.log('📧 Envoi notification admin');
    const filesListText = uploadedFiles.map(f => `- ${f.name}: ${f.webViewLink}`).join('\n');

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL,
      subject: `Nouveaux fichiers de ${prenom} ${nom}`,
      text: `${prenom} ${nom} (${email}) a uploadé ${files.length} fichier(s).\n\nMessage: ${message || 'Aucun'}\n\nFichiers:\n${filesListText}`,
      html: `
        <h2>Nouveaux fichiers de ${prenom} ${nom}</h2>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Message:</strong> ${message || 'Aucun'}</p>
        <p><strong>Fichiers:</strong></p>
        <ul>
          ${uploadedFiles.map(f => `<li><a href="${f.webViewLink}">${f.name}</a></li>`).join('')}
        </ul>
      `
    });
    console.log('✅ Notification admin envoyée');

    res.json({
      success: true,
      message: 'Fichiers uploadés avec succès',
      folderId,
      files: uploadedFiles
    });

  } catch (error) {
    console.error('❌ Erreur:', error);

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