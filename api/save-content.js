/* ==========================================================
   api/save-content.js
   Vercel Serverless Function — Guarda contenido del admin en GitHub
   Cuando el admin guarda, este endpoint:
   1. Recibe el contenido serializado
   2. Lo commit en el repositorio vía GitHub API
   3. Otros dispositivos lo cargan desde GitHub raw

   REQUISITOS (configurar en Vercel → Settings → Environment Variables):
   - GITHUB_TOKEN: Personal Access Token con permiso 'repo'
   - GITHUB_REPO: avimateo2-ui/EL-BODEGON-LOS-TRAJES-3-2026
   ========================================================== */

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO = process.env.GITHUB_REPO || 'avimateo2-ui/EL-BODEGON-LOS-TRAJES-3-2026';
  const FILE_PATH = 'data/admin-content.js';

  if (!GITHUB_TOKEN) {
    return res.status(500).json({
      error: 'GITHUB_TOKEN no está configurado en las variables de entorno de Vercel.'
    });
  }

  try {
    const { content, message } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Falta el campo content.' });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return res.status(400).json({ error: 'Content no es JSON válido.' });
    }

    const hasRealChanges =
      (parsed.texts && parsed.texts.length > 0) ||
      (parsed.images && parsed.images.length > 0) ||
      (parsed.addCards && parsed.addCards.length > 0) ||
      (parsed.addTexts && parsed.addTexts.length > 0) ||
      (parsed.deleteCards && parsed.deleteCards.length > 0) ||
      (parsed.deleteTexts && parsed.deleteTexts.length > 0) ||
      (parsed.seasonCovers && Object.keys(parsed.seasonCovers).length > 0) ||
      (parsed.photoSettings && Object.keys(parsed.photoSettings).length > 0) ||
      (parsed.editorStyles && Object.keys(parsed.editorStyles).length > 0) ||
      parsed.passwordHash ||
      parsed.usernameHash;

    if (!hasRealChanges) {
      return res.status(200).json({
        ok: true,
        message: 'Sin cambios reales, no se actualiza GitHub.',
        skipped: true
      });
    }

    const getFileUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`;
    const getRes = await fetch(getFileUrl, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    let sha = null;
    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData.sha;

      if (sha) {
        const rawRes = await fetch(`https://raw.githubusercontent.com/${GITHUB_REPO}/main/${FILE_PATH}?t=${Date.now()}`);
        if (rawRes.ok) {
          const rawText = await rawRes.text();
          const rawMatch = rawText.match(/window\.ADMIN_CONTENT\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
          if (rawMatch) {
            try {
              const currentRemote = JSON.parse(rawMatch[1]);
              const remoteHasChanges =
                (currentRemote.texts && currentRemote.texts.length > 0) ||
                (currentRemote.images && currentRemote.images.length > 0) ||
                (currentRemote.addCards && currentRemote.addCards.length > 0) ||
                (currentRemote.addTexts && currentRemote.addTexts.length > 0) ||
                (currentRemote.seasonCovers && Object.keys(currentRemote.seasonCovers).length > 0) ||
                currentRemote.passwordHash;

              if (remoteHasChanges && !hasRealChanges) {
                return res.status(200).json({ ok: true, message: 'Remoto tiene contenido real, no se sobreescribe.', skipped: true });
              }
            } catch (e) {}
          }
        }
      }
    }

    const fileContent = 'window.ADMIN_CONTENT = ' + content + ';';
    const encoded = Buffer.from(fileContent).toString('base64');

    const body = {
      message: message || `Admin update: ${new Date().toISOString()}`,
      content: encoded,
      committer: {
        name: 'El Bodegón Admin',
        email: 'avimateo2@gmail.com'
      }
    };

    if (sha) {
      body.sha = sha;
    }

    const putRes = await fetch(getFileUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify(body)
    });

    if (!putRes.ok) {
      const errData = await putRes.json().catch(() => ({}));
      return res.status(putRes.status).json({
        error: 'Error al guardar en GitHub: ' + (errData.message || putRes.statusText)
      });
    }

    const result = await putRes.json();

    return res.status(200).json({
      ok: true,
      message: 'Contenido guardado en GitHub. Los dispositivos lo cargarán automáticamente.',
      commit: result.commit ? result.commit.sha.substring(0, 7) : null,
      url: result.commit ? result.commit.html_url : null
    });

  } catch (err) {
    return res.status(500).json({
      error: 'Error del servidor: ' + err.message
    });
  }
};
