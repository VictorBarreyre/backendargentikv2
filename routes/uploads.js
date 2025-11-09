// routes/uploads.js
const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const fs = require('fs');

const router = express.Router();

// Configuration de Multer pour l'upload temporaire
const upload = multer({
  dest: 'temp/',
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max par fichier
});

// ✅ Configuration OAuth2 (au lieu du compte de service)
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/oauth2callback'
);

// Définir les credentials avec le refresh token
oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

const drive = google.drive({ version: 'v3', auth: oauth2Client });

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
      fields: 'files(id, name)'
    });

    if (response.data.files && response.data.files.length > 0) {
      return response.data.files[0].id;
    }
    return null;
  } catch (error) {
    console.error('❌ Erreur recherche dossier:', error.message);
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
      fields: 'id, name'
    });

    console.log(`✅ Dossier créé: ${folder.data.name}`);
    return folder.data.id;
  } catch (error) {
    console.error('❌ Erreur création dossier:', error.message);
    throw error;
  }
}

// Fonction pour obtenir ou créer un dossier (évite la duplication)
async function getOrCreateFolder(folderName, parentFolderId) {
  console.log(`🔍 Recherche du dossier "${folderName}"...`);
  
  let folderId = await findFolder(folderName, parentFolderId);

  if (folderId) {
    console.log(`✅ Dossier existant trouvé: ${folderId}`);
    return folderId;
  }

  console.log(`📁 Création du nouveau dossier: ${folderName}`);
  folderId = await createFolder(folderName, parentFolderId);
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
      fields: 'id, name, webViewLink'
    });

    console.log(`✅ Fichier uploadé: ${file.data.name}`);
    return file.data;
  } catch (error) {
    console.error('❌ Erreur upload fichier:', error.message);
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
  console.log(`✅ Email envoyé à ${userEmail}`);
}

// Route principale
router.post('/upload-and-send', upload.array('files'), async (req, res) => {
  try {
    console.log('📥 Requête reçue');
    console.log('👤 Body:', req.body);
    console.log('📁 Files:', req.files?.length, 'fichier(s)');

    const { nom, prenom, email, message, issue } = req.body;
    const files = req.files;

    // Validation
    if (!nom || !prenom || !email || !files || files.length === 0) {
      console.log('❌ Validation échouée');
      return res.status(400).json({ error: 'Données manquantes' });
    }

    // Vérifier la configuration
    const PARENT_FOLDER_ID = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
    if (!PARENT_FOLDER_ID) {
      console.log('❌ GOOGLE_DRIVE_PARENT_FOLDER_ID manquant');
      return res.status(500).json({ error: 'Configuration Google Drive manquante' });
    }

    // 1. Obtenir ou créer le dossier de l'issue (BREAK par exemple)
    const issueFolderName = issue || 'BREAK'; // Par défaut "BREAK" si pas d'issue fournie
    console.log(`📂 Traitement du dossier issue: ${issueFolderName}`);
    const issueFolderId = await getOrCreateFolder(issueFolderName, PARENT_FOLDER_ID);

    // 2. Obtenir ou créer le dossier du contributeur dans le dossier de l'issue
    const contributorFolderName = `${prenom}_${nom}`;
    console.log(`📂 Traitement du dossier contributeur: ${contributorFolderName}`);
    const contributorFolderId = await getOrCreateFolder(contributorFolderName, issueFolderId);

    // 3. Upload des fichiers dans le dossier du contributeur
    const uploadedFiles = [];
    for (const file of files) {
      console.log(`⬆️ Upload du fichier: ${file.originalname}`);
      const uploadedFile = await uploadFileToDrive(
        file.path,
        file.originalname,
        contributorFolderId
      );
      uploadedFiles.push(uploadedFile);

      // Supprimer le fichier temporaire
      fs.unlinkSync(file.path);
    }

    // 4. Envoyer l'email de confirmation
    console.log(`📧 Envoi email de confirmation à: ${email}`);
    await sendEmail(email, nom, prenom, uploadedFiles);

    // 5. Envoyer une notification interne (si ADMIN_EMAIL configuré)
    if (process.env.ADMIN_EMAIL) {
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
    }

    console.log('🎉 Upload terminé avec succès');
    res.json({
      success: true,
      message: 'Fichiers uploadés avec succès',
      issueFolderId,
      contributorFolderId,
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