/* Panel de administrador para El Bodegón de los Trajes.
   - Acceso: botón flotante + contraseña.
   - Edita textos, cambia fotos, publica contenido nuevo y borra contenido.
   - Guarda todo en el archivo externo admin-content.json (se descarga y se
     reemplaza en la misma carpeta del sitio). */
(function () {
  'use strict';

  var DEFAULT_PASSWORD = 'ANAISABEL2026';
  var DEFAULT_USERNAME = 'Ana Avila';
  var SESSION_KEY = 'bodegon_admin_session';
  var AUTOSAVE_KEY = 'bodegon_autosave';
  var CLOUD_SYNC_API = '/api/save-content';
  var cloudSyncTimer = null;
  var CLOUD_SYNC_DELAY = 2500;

  var content = {
    version: 1,
    usernameHash: null,
    passwordHash: null,
    texts: [],
    images: [],
    addCards: [],
    addTexts: [],
    deleteCards: [],
    deleteTexts: [],
    seasonCovers: {}
  };

  var authed = false;
  var editMode = false;
  var loginAttempts = 0;
  var lockUntil = 0;
  var LOCK_MS = 4 * 60 * 1000;
  var CONTACT_PHONE = '3107706615';

  /* ---------- utilidades ---------- */

  function compressImage(dataUrl, maxWidth, quality) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var w = img.width;
        var h = img.height;
        if (w > maxWidth) {
          h = Math.round(h * maxWidth / w);
          w = maxWidth;
        }
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    }
    return 'h' + h.toString(16);
  }

  function uid() {
    return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function cssPath(el) {
    if (!el) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    if (el === document.body) return 'body';
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1) {
      if (node.id) {
        parts.unshift('#' + CSS.escape(node.id));
        break;
      }
      var tag = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (parent) {
        var idx = Array.prototype.indexOf.call(parent.children, node) + 1;
        parts.unshift(tag + ':nth-child(' + idx + ')');
      } else {
        parts.unshift(tag);
      }
      node = parent;
    }
    return parts.join(' > ');
  }

  function q(path) {
    try { return document.querySelector(path); } catch (e) { return null; }
  }

  function qa(path) {
    try { return document.querySelectorAll(path); } catch (e) { return []; }
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'admin-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('is-show'); }, 20);
    setTimeout(function () {
      t.classList.remove('is-show');
      setTimeout(function () { t.remove(); }, 400);
    }, 2600);
  }

  /* ---------- edición de texto ---------- */

  var TEXT_SEL = [
    '#inicio .hero-box h2',
    '#inicio .hero-box p',
    '.section-head h2',
    '.section-head p',
    '.section-head span',
    '.season-title',
    '.season-subtitle',
    '.season-milestone',
    '.season-blank-title',
    '.season-catalog h4',
    '.season-catalog-tag',
    '.catalog-group-title',
    '.catalog-note p',
    '.season-item-body h4',
    '.season-item-body p',
    '.essence-heading',
    '.essence-lead',
    '.essence-detail',
    '.essence-cat',
    '.subsection-body h4',
    '.subsection-body p',
    '.subsection-list li',
    '.contact-card h3',
    '.contact-intro',
    '.contact-detail p',
    'footer p',
    '.halloween-landing-title',
    '.halloween-landing-sub',
    '.season-tab .tab-label',
    '.dropdown-grid a',
    '.season-quick-nav a'
  ].join(',');

  function isEditableText(el) {
    if (!el || el.closest('.admin-ui')) return false;
    return !!el.closest(TEXT_SEL);
  }

  function editElement(el) {
    if (el.dataset && el.dataset.adminTarget) {
      el = q(el.dataset.adminTarget);
    }
    if (!el) return;
    if (el.tagName === 'IMG') { editImage(el); return; }
    editText(el);
  }

  function findEntry(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function editText(el) {
    var addedHost = el.closest('[data-admin-id]');
    var entry = addedHost ? findEntry(content.addCards.concat(content.addTexts), addedHost.dataset.adminId) : null;
    var isEditableHtml = /^[Hh][1-6]$/.test(el.tagName) || el.tagName === 'P' || el.tagName === 'SPAN' || el.tagName === 'LI' || el.tagName === 'A';
    var initial = isEditableHtml ? el.innerHTML : el.textContent;
    var useHtml = isEditableHtml;

    var box = openModal(
      '<h3>Editar texto</h3>' +
      '<label class="admin-field">Contenido</label>' +
      '<textarea class="admin-textarea" rows="6" data-role="value"></textarea>' +
      (useHtml ? '<p class="admin-hint">Puedes usar etiquetas HTML (ej. &lt;strong&gt;texto&lt;/strong&gt;).</p>' : '') +
      '<div class="admin-modal-actions">' +
      '<button type="button" class="admin-btn admin-btn-danger" data-role="del">Quitar</button>' +
      '<button type="button" class="admin-btn admin-btn-primary" data-role="ok">Guardar</button>' +
      '<button type="button" class="admin-btn" data-role="cancel">Cancelar</button>' +
      '</div>'
    );
    box.querySelector('[data-role="value"]').value = initial;

    box.querySelector('[data-role="del"]').addEventListener('click', function () {
      closeModal(box);
      deleteEl(el);
      autoSave();
      toast('Elemento quitado.');
    });
    box.querySelector('[data-role="ok"]').addEventListener('click', function () {
      var val = box.querySelector('[data-role="value"]').value;
      if (useHtml) el.innerHTML = val; else el.textContent = val;
      if (entry && entry._type === 'card') {
        if (el.matches('h3')) entry.title = stripHtml(val);
        else entry.desc = stripHtml(val);
      } else if (entry && entry._type === 'text') {
        entry.html = val;
      } else {
        saveTextPatch(el, useHtml ? val : esc(val));
      }
      closeModal(box);
      autoSave();
      toast('Texto actualizado.');
    });
    box.querySelector('[data-role="cancel"]').addEventListener('click', function () { closeModal(box); });
  }

  function stripHtml(s) {
    return String(s).replace(/<[^>]*>/g, '').trim();
  }

  function saveTextPatch(el, val) {
    var path = cssPath(el);
    for (var i = 0; i < content.texts.length; i++) {
      if (content.texts[i].sel === path) { content.texts[i].html = val; return; }
    }
    content.texts.push({ sel: path, html: val });
  }

  /* ---------- edición de imágenes ---------- */

  function editImage(img, autoOpen) {
    var addedHost = img.closest('[data-admin-id]');
    var entry = addedHost ? findEntry(content.addCards, addedHost.dataset.adminId) : null;

    var box = openModal(
      '<h3>Cambiar foto</h3>' +
      '<label class="admin-field">Subir imagen</label>' +
      '<input type="file" class="admin-file" data-role="file" accept="image/*">' +
      '<label class="admin-field">O pegar URL de imagen</label>' +
      '<input type="text" class="admin-input" data-role="url" placeholder="https://...">' +
      '<div class="admin-preview" data-role="preview"><img src="" alt=""></div>' +
      '<div class="admin-modal-actions">' +
      '<button type="button" class="admin-btn admin-btn-primary" data-role="ok">Aplicar</button>' +
      '<button type="button" class="admin-btn" data-role="cancel">Cancelar</button>' +
      '</div>'
    );
    var fileInp = box.querySelector('[data-role="file"]');
    var urlInp = box.querySelector('[data-role="url"]');
    var preview = box.querySelector('[data-role="preview"] img');
    var pendingData = null;

    fileInp.addEventListener('change', function () {
      var f = fileInp.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        pendingData = rd.result;
        preview.src = pendingData;
      };
      rd.readAsDataURL(f);
    });
    urlInp.addEventListener('input', function () {
      if (urlInp.value.trim()) preview.src = urlInp.value.trim();
    });
    if (autoOpen) fileInp.click();

    box.querySelector('[data-role="ok"]').addEventListener('click', function () {
      var src = pendingData || urlInp.value.trim();
      if (!src) { toast('Elige una imagen o pega una URL.'); return; }
      function applyImage(finalSrc) {
        img.src = finalSrc;
        if (entry) {
          entry.img = finalSrc;
        } else {
          var path = cssPath(img);
          for (var i = 0; i < content.images.length; i++) {
            if (content.images[i].sel === path) { content.images[i].src = finalSrc; closeModal(box); autoSave(); toast('Foto actualizada.'); return; }
          }
          content.images.push({ sel: path, src: finalSrc });
        }
        closeModal(box);
        autoSave();
        toast('Foto actualizada.');
      }
      if (src.indexOf('data:') === 0) {
        compressImage(src, 1000, 0.55).then(applyImage);
      } else {
        applyImage(src);
      }
    });
    box.querySelector('[data-role="cancel"]').addEventListener('click', function () { closeModal(box); });
  }

  /* ---------- publicar contenido nuevo ---------- */

  function seasonPhotoButton(panel) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'admin-ui admin-seasbtn';
    btn.innerHTML = '&#128247; <span>Cambiar fotos de esta temporada</span>';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      changeSeasonPhotos(panel);
    });
    return btn;
  }

  function changeSeasonPhotos(panel) {
    var imgs = panel.querySelectorAll('img');
    if (!imgs.length) { toast('No hay fotos en esta temporada.'); return; }
    var list = '';
    Array.prototype.forEach.call(imgs, function (img, i) {
      list +=
        '<div class="admin-photorow">' +
        '<img src="' + esc(img.currentSrc || img.src) + '" alt="">' +
        '<button type="button" class="admin-btn" data-idx="' + i + '">Cambiar</button>' +
        '</div>';
    });
    var box = openModal(
      '<h3>Fotos de la temporada</h3>' +
      '<p class="admin-hint">Toca "Cambiar" y elige la foto nueva desde tu dispositivo.</p>' +
      list +
      '<div class="admin-modal-actions">' +
      '<button type="button" class="admin-btn admin-btn-primary" data-role="close">Cerrar</button>' +
      '</div>'
    );
    Array.prototype.forEach.call(box.querySelectorAll('[data-idx]'), function (b) {
      b.addEventListener('click', function () {
        var img = imgs[parseInt(b.dataset.idx, 10)];
        closeModal(box);
        editImage(img, true);
      });
    });
    box.querySelector('[data-role="close"]').addEventListener('click', function () { closeModal(box); });
  }

  function addCardButton(host) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'admin-ui admin-addbtn';
    btn.innerHTML = '+ <span>Agregar tarjeta</span>';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      publishCard(host);
    });
    return btn;
  }

  function addTextButton(host) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'admin-ui admin-addbtn admin-addbtn-text';
    btn.innerHTML = '+ <span>Agregar párrafo</span>';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      publishText(host);
    });
    return btn;
  }

  function delButton() {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'admin-ui admin-delbtn';
    b.title = 'Quitar este elemento';
    b.innerHTML = '&#10005;';
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      if (window.confirm('¿Quitar este elemento?')) {
        deleteEl(b.closest('.admin-delbtn-host') || b.parentElement);
        autoSave();
        toast('Elemento quitado.');
      }
    });
    return b;
  }

  function ensureDelButtons() {
    if (!editMode) return;
    qa('.card-ghost').forEach(function (card) {
      if (card.querySelector('.admin-delbtn')) return;
      card.classList.add('admin-delbtn-host');
      card.appendChild(delButton());
    });
    qa('.admin-added-text').forEach(function (p) {
      if (p.querySelector('.admin-delbtn')) return;
      p.classList.add('admin-delbtn-host');
      p.appendChild(delButton());
    });
  }

  /* botón directo sobre cada foto para cambiarla con un solo clic */
  function photoChangeButton(img) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'admin-ui admin-photobtn';
    b.title = 'Cambiar foto';
    b.innerHTML = '&#128247;';
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      editImage(img, true);
    });
    return b;
  }

  function ensurePhotoButtons() {
    if (!editMode) return;
    Array.prototype.forEach.call(document.querySelectorAll('img'), function (img) {
      if (img.closest('.admin-ui')) return;
      var parent = img.parentElement;
      if (!parent || parent === document.body) return;
      if (parent.querySelector('.admin-photobtn')) return;
      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
      parent.appendChild(photoChangeButton(img));
    });
  }

  function wireSeasonPhotoButtons() {
    qa('.admin-season-photo-btn').forEach(function (btn) {
      if (btn.dataset.adminWired) return;
      btn.dataset.adminWired = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        var month = btn.dataset.seasonPhoto;
        var landing;
        if (month === 'hero') {
          landing = document.getElementById('inicio');
        } else {
          landing = document.querySelector('.halloween-landing[data-landing="' + month + '"]') ||
                    document.getElementById('halloween-landing');
        }
        if (!landing) { toast('No se encontró la portada.'); return; }
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', function () {
          var f = input.files[0];
          if (!f) return;
          var rd = new FileReader();
          rd.onload = function () {
            compressImage(rd.result, 1000, 0.55).then(function (compressed) {
              landing.classList.add('has-cover-photo');
              landing.style.backgroundImage = 'url(' + compressed + ')';
              landing.style.backgroundSize = 'cover';
              landing.style.backgroundPosition = 'center';
              content.seasonCovers[month] = compressed;
              autoSave();
              toast('Portada de ' + month + ' actualizada.');
            });
          };
          rd.readAsDataURL(f);
        });
        input.click();
      });
    });
  }

  function publishCard(host) {
    var grid = host.classList.contains('grid-haunted') ? host : null;
    var section = grid ? host.closest('.season-catalog') : host;

    var box = openModal(
      '<h3>Publicar tarjeta nueva</h3>' +
      '<label class="admin-field">Foto</label>' +
      '<input type="file" class="admin-file" data-role="file" accept="image/*">' +
      '<label class="admin-field">O URL de la foto</label>' +
      '<input type="text" class="admin-input" data-role="url" placeholder="https://...">' +
      '<label class="admin-field">Título</label>' +
      '<input type="text" class="admin-input" data-role="title" placeholder="Nombre del traje">' +
      '<label class="admin-field">Descripción</label>' +
      '<textarea class="admin-textarea" rows="3" data-role="desc" placeholder="Describe el traje..."></textarea>' +
      '<div class="admin-modal-actions">' +
      '<button type="button" class="admin-btn admin-btn-primary" data-role="ok">Publicar</button>' +
      '<button type="button" class="admin-btn" data-role="cancel">Cancelar</button>' +
      '</div>'
    );
    var pending = null;
    box.querySelector('[data-role="file"]').addEventListener('change', function () {
      var f = box.querySelector('[data-role="file"]').files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { pending = rd.result; };
      rd.readAsDataURL(f);
    });

    box.querySelector('[data-role="ok"]').addEventListener('click', function () {
      var src = pending || box.querySelector('[data-role="url"]').value.trim();
      var title = box.querySelector('[data-role="title"]').value.trim();
      var desc = box.querySelector('[data-role="desc"]').value.trim();
      if (!src || !title) { toast('La foto y el título son obligatorios.'); return; }

      function saveCard(imgSrc) {
        var entry = { id: uid(), _type: 'card', container: cssPath(grid || section), img: imgSrc, title: title, desc: desc };
        content.addCards.push(entry);
        insertCard(entry);
        closeModal(box);
        autoSave();
        toast('Tarjeta publicada.');
      }

      if (src.indexOf('data:') === 0) {
        compressImage(src, 1000, 0.55).then(saveCard);
      } else {
        saveCard(src);
      }
    });
    box.querySelector('[data-role="cancel"]').addEventListener('click', function () { closeModal(box); });
  }

  function insertCard(entry) {
    var host = q(entry.container) || (entry.container && document.body);
    if (!host) return;
    var grid = host.classList.contains('grid-haunted') ? host : host.querySelector('.grid-haunted');
    if (!grid) {
      var sec = host;
      grid = document.createElement('div');
      grid.className = 'grid-haunted';
      sec.appendChild(grid);
      var blank = sec.querySelector('.season-blank-title');
      if (blank) blank.style.display = 'none';
      var secTag = sec.querySelector('.season-catalog-tag');
      if (secTag) {
        sec.insertBefore(grid, secTag.nextSibling ? secTag.nextSibling : null);
      }
    }
    var card = document.createElement('div');
    card.className = 'card-ghost admin-added';
    card.dataset.adminId = entry.id;
    card.innerHTML =
      '<div class="img-ghost"><img src="' + esc(entry.img) + '" alt="' + esc(entry.title) + '"></div>' +
      '<div class="card-body-haunted"><h3>' + esc(entry.title) + '</h3><p>' + esc(entry.desc) + '</p></div>';
    grid.appendChild(card);
    wireCard(card, entry);
    if (editMode) ensureDelButtons();
    if (editMode) ensurePhotoButtons();
  }

  function publishText(host) {
    var box = openModal(
      '<h3>Publicar párrafo nuevo</h3>' +
      '<label class="admin-field">Contenido</label>' +
      '<textarea class="admin-textarea" rows="4" data-role="value" placeholder="Escribe el texto..."></textarea>' +
      '<div class="admin-modal-actions">' +
      '<button type="button" class="admin-btn admin-btn-primary" data-role="ok">Publicar</button>' +
      '<button type="button" class="admin-btn" data-role="cancel">Cancelar</button>' +
      '</div>'
    );
    box.querySelector('[data-role="ok"]').addEventListener('click', function () {
      var val = box.querySelector('[data-role="value"]').value.trim();
      if (!val) { toast('Escribe algo para publicar.'); return; }
      var entry = { id: uid(), _type: 'text', container: cssPath(host), html: val };
      content.addTexts.push(entry);
      insertText(entry);
      closeModal(box);
      autoSave();
      toast('Párrafo publicado.');
    });
    box.querySelector('[data-role="cancel"]').addEventListener('click', function () { closeModal(box); });
  }

  function insertText(entry) {
    var host = q(entry.container);
    if (!host) return;
    var p = document.createElement('p');
    p.className = 'season-subtitle admin-added-text';
    p.dataset.adminId = entry.id;
    p.innerHTML = entry.html;
    host.appendChild(p);
    wireText(p, entry);
    if (editMode) ensureDelButtons();
  }
  /* ---------- borrar contenido ---------- */

  function deleteEl(el) {
    var addedHost = el.closest('[data-admin-id]');
    if (addedHost) {
      var id = addedHost.dataset.adminId;
      content.addCards = content.addCards.filter(function (c) { return c.id !== id; });
      content.addTexts = content.addTexts.filter(function (t) { return t.id !== id; });
      addedHost.remove();
      return;
    }
    if (el.tagName === 'IMG') {
      var imgPath = cssPath(el);
      if (content.images.indexOf && content.images.length) {
        var found = content.images.some(function (im) { return im.sel === imgPath; });
        if (!found) {
          content.images.push({ sel: imgPath, src: '' });
        }
      } else {
        content.images.push({ sel: imgPath, src: '' });
      }
      el.remove();
      return;
    }
    var path = cssPath(el);
    var key = el.matches('.card-ghost, .card-ghost *') ? 'deleteCards' : 'deleteTexts';
    if (key === 'deleteCards') {
      var card = el.closest('.card-ghost');
      if (card) {
        var cpath = cssPath(card);
        if (content.deleteCards.indexOf(cpath) === -1) content.deleteCards.push(cpath);
        card.style.display = 'none';
      }
    } else {
      if (content.deleteTexts.indexOf(path) === -1) content.deleteTexts.push(path);
      el.style.display = 'none';
    }
  }

  /* ---------- modales ---------- */

  function openModal(html) {
    closeModal();
    var overlay = document.createElement('div');
    overlay.className = 'admin-modal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:1100;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(10,5,18,0.75);';
    overlay.innerHTML = '<div class="admin-modal-box">' + html + '</div>';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });
    document.body.appendChild(overlay);
    return overlay;
  }

  function closeModal() {
    var m = document.querySelector('.admin-modal');
    if (m) m.remove();
  }

  /* ---------- aplicar contenido guardado ---------- */

  function applyContent() {
    content.texts.forEach(function (p) {
      var el = q(p.sel);
      if (el) {
        if (/^[Hh][1-6]$/.test(el.tagName) || el.tagName === 'P' || el.tagName === 'SPAN' || el.tagName === 'LI' || el.tagName === 'A') el.innerHTML = p.html;
        else el.textContent = p.html;
      }
    });
    content.images.forEach(function (im) {
      var el = q(im.sel);
      if (el) {
        if (im.src) el.src = im.src;
        else el.remove();
      }
    });
    content.deleteCards.forEach(function (p) {
      var el = q(p);
      if (el) el.style.display = 'none';
    });
    content.deleteTexts.forEach(function (p) {
      var el = q(p);
      if (el) el.style.display = 'none';
    });
    content.addCards.forEach(function (entry) {
      insertCard(entry);
    });
    content.addTexts.forEach(function (entry) {
      insertText(entry);
    });
  }

  function applySeasonCovers() {
    Object.keys(content.seasonCovers).forEach(function (month) {
      var src = content.seasonCovers[month];
      if (!src) return;
      var landing;
      if (month === 'hero') {
        landing = document.getElementById('inicio');
      } else {
        landing = document.querySelector('.halloween-landing[data-landing="' + month + '"]') ||
                  document.getElementById('halloween-landing');
      }
      if (!landing) return;
      landing.classList.add('has-cover-photo');
      landing.style.backgroundImage = 'url(' + src + ')';
      landing.style.backgroundSize = 'cover';
      landing.style.backgroundPosition = 'center';
    });
  }

  /* ---------- wire de elementos dinámicos ---------- */

  function wireCard(card, entry) {
    var img = card.querySelector('img');
    if (img) {
      img.addEventListener('click', function (e) {
        if (!editMode) return;
        e.stopPropagation();
        e.preventDefault();
        editImage(img);
      });
    }
    var h3 = card.querySelector('h3');
    var p = card.querySelector('p');
    [h3, p].forEach(function (t) {
      if (t) t.addEventListener('click', function (e) {
        if (!editMode) return;
        e.stopPropagation();
        e.preventDefault();
        editText(t);
      });
    });
  }

  function wireText(p) {
    p.addEventListener('click', function (e) {
      if (!editMode) return;
      e.stopPropagation();
      e.preventDefault();
      editText(p);
    });
  }

  /* ---------- panel de administración ---------- */

  function buildFab() {
    var fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'admin-ui admin-fab';
    fab.title = 'Iniciar sesión como administrador';
    fab.innerHTML = '&#128274;';
    fab.addEventListener('click', function () {
      if (!authed) { openLogin(); return; }
      if (window.confirm('¿Cerrar sesión de administrador?')) {
        authed = false;
        try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
        disableEditMode();
        updateFabState();
        toast('Sesión cerrada.');
      }
    });
    document.body.appendChild(fab);
  }

  function updateFabState() {
    var fab = document.querySelector('.admin-fab');
    if (!fab) return;
    if (authed) {
      fab.classList.add('is-logged-in');
      fab.title = 'Sesión activa — clic para cerrar sesión';
      fab.innerHTML = '&#128100;';
    } else {
      fab.classList.remove('is-logged-in');
      fab.title = 'Iniciar sesión como administrador';
      fab.innerHTML = '&#128274;';
    }
  }

  function openLogin() {
    var box = openModal(
      '<h3>Acceso de administrador</h3>' +
      '<label class="admin-field">Usuario</label>' +
      '<input type="text" class="admin-input" data-role="user" autocomplete="username">' +
      '<label class="admin-field">Contraseña</label>' +
      '<input type="password" class="admin-input" data-role="pass" autocomplete="current-password">' +
      '<p class="admin-hint" data-role="hint"></p>' +
      '<div class="admin-modal-actions">' +
      '<button type="button" class="admin-btn admin-btn-primary" data-role="ok">Entrar</button>' +
      '<button type="button" class="admin-btn" data-role="cancel">Cancelar</button>' +
      '</div>'
    );
    var userInp = box.querySelector('[data-role="user"]');
    var inp = box.querySelector('[data-role="pass"]');
    var okBtn = box.querySelector('[data-role="ok"]');
    var hint = box.querySelector('[data-role="hint"]');
    var timer = null;

    function fmt(s) {
      var m = Math.floor(s / 60);
      var sec = s % 60;
      return m + ':' + (sec < 10 ? '0' : '') + sec;
    }

    function setLocked(remaining) {
      userInp.disabled = true;
      inp.disabled = true;
      okBtn.disabled = true;
      hint.innerHTML = 'Máximo de intentos alcanzado. Si olvidaste la contraseña, comunícate al <a href="https://wa.me/573107706615" target="_blank" rel="noopener"><strong>' + CONTACT_PHONE + '</strong></a>. Podrás intentar de nuevo en ' + fmt(remaining) + '.';
    }

    function unlock() {
      loginAttempts = 0;
      lockUntil = 0;
      userInp.disabled = false;
      inp.disabled = false;
      okBtn.disabled = false;
      hint.textContent = 'Puedes intentar de nuevo.';
    }

    function tick() {
      if (!box.isConnected) { clearInterval(timer); return; }
      var left = Math.max(0, Math.round((lockUntil - Date.now()) / 1000));
      if (left <= 0) {
        unlock();
        clearInterval(timer);
        return;
      }
      setLocked(left);
    }

    function lockNow() {
      lockUntil = Date.now() + LOCK_MS;
      setLocked(LOCK_MS / 1000);
      clearInterval(timer);
      timer = setInterval(tick, 1000);
    }

    box.querySelector('[data-role="cancel"]').addEventListener('click', function () {
      clearInterval(timer);
      closeModal(box);
    });

    if (Date.now() < lockUntil) {
      setLocked(Math.max(0, Math.round((lockUntil - Date.now()) / 1000)));
      timer = setInterval(tick, 1000);
      return;
    }

    function tryLogin() {
      if (loginAttempts >= 5) return;
      var expectedU = content.usernameHash || hash(DEFAULT_USERNAME);
      var expectedP = content.passwordHash || hash(DEFAULT_PASSWORD);
      if (hash(userInp.value) === expectedU && hash(inp.value) === expectedP) {
        authed = true;
        loginAttempts = 0;
        lockUntil = 0;
        try { localStorage.setItem(SESSION_KEY, '1'); } catch (e) {}
        clearInterval(timer);
        closeModal();
        enableEditMode();
        updateFabState();
        toast('Bienvenido, administrador.');
      } else {
        loginAttempts++;
        var left = 5 - loginAttempts;
        if (left <= 0) {
          lockNow();
        } else {
          hint.textContent = 'Error, intenta de nuevo. Te quedan ' + left + ' intento' + (left === 1 ? '' : 's') + '.';
        }
      }
    }
    box.querySelector('[data-role="ok"]').addEventListener('click', tryLogin);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryLogin(); });
    setTimeout(function () { userInp.focus(); }, 60);
  }

  function enableEditMode() {
    editMode = true;
    document.body.classList.add('admin-edit-mode');
    ensureToolbar();
    ensureLogoutFab();
    ensureSaveFab();
    ensureAddButtons();
    ensureDelButtons();
    ensurePhotoButtons();
    wireStatic();
    wireSeasonPhotoButtons();
  }

  function disableEditMode() {
    editMode = false;
    document.body.classList.remove('admin-edit-mode');
    var tb = document.querySelector('.admin-toolbar');
    if (tb) tb.remove();
    var lo = document.querySelector('.admin-logout-fab');
    if (lo) lo.remove();
    var sf = document.querySelector('.admin-save-fab');
    if (sf) sf.remove();
    qa('.admin-addbtn').forEach(function (b) { b.remove(); });
    qa('.admin-delbtn').forEach(function (b) { b.remove(); });
    qa('.admin-seasbtn').forEach(function (b) { b.remove(); });
    qa('.admin-photobtn').forEach(function (b) { b.remove(); });
  }

  function ensureToolbar() {
    if (document.querySelector('.admin-toolbar')) return;
    var tb = document.createElement('div');
    tb.className = 'admin-ui admin-toolbar';
    tb.innerHTML =
      '<span class="admin-toolbar-title">Modo administrador</span>' +
      '<button type="button" class="admin-btn admin-btn-primary" data-role="save">Guardar</button>' +
      '<button type="button" class="admin-btn admin-btn-export" data-role="export">Descargar cambios</button>' +
      '<button type="button" class="admin-btn" data-role="password">Cambiar contraseña</button>';
    document.body.appendChild(tb);

    var saveBtn = tb.querySelector('[data-role="save"]');
    var saveTimer = setInterval(function () {
      if (!tb.isConnected) { clearInterval(saveTimer); return; }
      var activePanel = document.querySelector('.season-panel.is-active');
      var isEnero = activePanel && activePanel.dataset && activePanel.dataset.panel === 'enero';
      saveBtn.style.display = isEnero ? '' : 'none';
    }, 800);

    saveBtn.addEventListener('click', function () {
      autoSave();
      toast('Guardado en el navegador.');
    });
    tb.querySelector('[data-role="export"]').addEventListener('click', function () {
      saveToDisk();
    });
    tb.querySelector('[data-role="password"]').addEventListener('click', changePassword);
  }

  function ensureLogoutFab() {
    if (document.querySelector('.admin-logout-fab')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'admin-ui admin-logout-fab';
    b.title = 'Cerrar sesión';
    b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
    b.addEventListener('click', function () {
      authed = false;
      try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
      disableEditMode();
      updateFabState();
      toast('Sesión cerrada.');
    });
    document.body.appendChild(b);
  }

  function ensureSaveFab() {
    if (document.querySelector('.admin-save-fab')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'admin-ui admin-save-fab';
    b.title = 'Guardar cambios';
    b.innerHTML = '&#128190;';
    b.addEventListener('click', function () {
      autoSave();
      toast('Guardado en el navegador.');
    });
    document.body.appendChild(b);
  }

  function ensureAddButtons() {
    qa('.grid-haunted').forEach(function (g) {
      if (!g.querySelector('.admin-addbtn')) g.appendChild(addCardButton(g));
    });
    qa('.season-catalog').forEach(function (s) {
      if (!s.querySelector('.admin-addbtn-text')) s.appendChild(addTextButton(s));
    });
    qa('.season-subsection').forEach(function (s) {
      if (!s.querySelector('.admin-addbtn-text')) s.appendChild(addTextButton(s));
    });
    qa('.hero-horror .hero-box').forEach(function (s) {
      if (!s.querySelector('.admin-addbtn-text')) s.appendChild(addTextButton(s));
    });
    qa('.season-panel').forEach(function (p) {
      if (!p.querySelector('.admin-seasbtn')) p.insertBefore(seasonPhotoButton(p), p.firstChild);
    });
  }

  function wireStatic() {
    qa('.card-ghost').forEach(function (card) {
      if (card.dataset.adminWired) return;
      card.dataset.adminWired = '1';
      var img = card.querySelector('img');
      var h3 = card.querySelector('h3');
      var p = card.querySelector('p');
      if (img) img.addEventListener('click', function (e) {
        if (!editMode) return;
        e.stopPropagation();
        e.preventDefault();
        editImage(img);
      });
      [h3, p].forEach(function (t) {
        if (!t) return;
        t.addEventListener('click', function (e) {
          if (!editMode) return;
          e.stopPropagation();
          e.preventDefault();
          editText(t);
        });
      });
    });

    qa(TEXT_SEL).forEach(function (el) {
      if (el.closest('.admin-ui')) return;
      if (el.dataset.adminWired) return;
      if (el.matches('.card-ghost h3, .card-ghost p')) return;
      el.dataset.adminWired = '1';
      el.addEventListener('click', function (e) {
        if (!editMode) return;
        e.stopPropagation();
        e.preventDefault();
        editText(el);
      });
    });
  }

  /* ---------- guardar / cargar ---------- */

  /* ---------- auto-save en localStorage ---------- */

  function autoSave() {
    try {
      var data = serialize();
      localStorage.setItem(AUTOSAVE_KEY, data);
      showSaveIndicator();
      scheduleCloudSync();
    } catch (e) {
      toast('⚠️ No se pudo guardar. El almacenamiento está lleno. Intenta con fotos más pequeñas.');
    }
  }

  function showSaveIndicator() {
    var ind = document.querySelector('.admin-save-indicator');
    if (!ind) {
      ind = document.createElement('div');
      ind.className = 'admin-ui admin-save-indicator';
      ind.innerHTML = '<span class="admin-save-dot"></span> Guardado';
      document.body.appendChild(ind);
    }
    ind.classList.add('is-visible');
    clearTimeout(ind._timer);
    ind._timer = setTimeout(function () {
      ind.classList.remove('is-visible');
    }, 2000);
  }

  function scheduleCloudSync() {
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(syncToCloud, CLOUD_SYNC_DELAY);
  }

  function syncToCloud() {
    var syncBadge = document.querySelector('.admin-cloud-sync');
    if (!syncBadge) {
      syncBadge = document.createElement('div');
      syncBadge.className = 'admin-ui admin-cloud-sync';
      syncBadge.innerHTML = '<span class="admin-cloud-icon">☁</span> Sincronizando...';
      document.body.appendChild(syncBadge);
    }
    syncBadge.classList.add('is-visible');
    syncBadge.classList.remove('is-error', 'is-ok');

    var data = serialize();

    fetch(CLOUD_SYNC_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: data,
        message: 'Admin update: contenido actualizado desde el panel'
      })
    })
      .then(function (res) { return res.json(); })
      .then(function (res) {
        if (res.ok) {
          syncBadge.innerHTML = '<span class="admin-cloud-icon">✓</span> Sincronizado con GitHub';
          syncBadge.classList.add('is-ok');
          setTimeout(function () { syncBadge.classList.remove('is-visible', 'is-ok'); }, 3000);
        } else {
          throw new Error(res.error || 'Error desconocido');
        }
      })
      .catch(function (err) {
        syncBadge.innerHTML = '<span class="admin-cloud-icon">⚠</span> Sin conexión — guardado local';
        syncBadge.classList.add('is-error');
        setTimeout(function () { syncBadge.classList.remove('is-visible', 'is-error'); }, 4000);
        console.warn('[cloud-sync]', err.message || err);
      });
  }

  function loadAutoSave() {
    try {
      var raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      return parseWrapped(raw);
    } catch (e) { return null; }
  }

  function dedup(arr, key) {
    var seen = {};
    return arr.filter(function (item) {
      var k = typeof key === 'function' ? key(item) : item[key];
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  function serialize() {
    var out = {
      version: 1,
      usernameHash: content.usernameHash || null,
      passwordHash: content.passwordHash || null,
      texts: dedup(content.texts, 'sel'),
      images: dedup(content.images, 'sel'),
      addCards: content.addCards.map(function (c) {
        return { id: c.id, container: c.container, img: c.img, title: c.title, desc: c.desc };
      }),
      addTexts: content.addTexts.map(function (t) {
        return { id: t.id, container: t.container, html: t.html };
      }),
      deleteCards: content.deleteCards,
      deleteTexts: content.deleteTexts,
      seasonCovers: content.seasonCovers || {}
    };
    return JSON.stringify(out, null, 2);
  }

  function downloadJson() {
    var text = 'window.ADMIN_CONTENT = ' + serialize() + ';';
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'admin-content.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    toast('Descargado: admin-content.json. Reemplaza el archivo en la carpeta del sitio.');
  }

  function saveToDisk() {
    if (window.showSaveFilePicker) {
      showSaveFilePicker({
        suggestedName: 'admin-content.json',
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
      }).then(function (handle) {
        return handle.createWritable().then(function (w) {
          return w.write('window.ADMIN_CONTENT = ' + serialize() + ';').then(function () { return w.close(); });
        });
      }).then(function () {
        toast('Guardado en admin-content.json.');
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        downloadJson();
      });
    } else {
      downloadJson();
    }
  }

  function loadFromFile(file) {
    if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var text = rd.result;
        var obj = parseWrapped(text);
        applyData(obj);
        toast('Contenido cargado y aplicado.');
      } catch (e) {
        toast('No se pudo leer el JSON: ' + e.message);
      }
    };
    rd.readAsText(file);
  }

  function parseWrapped(text) {
    var t = String(text).trim();
    var json = t;
    var m = t.match(/^\s*window\.ADMIN_CONTENT\s*=\s*/);
    if (m) {
      json = t.slice(m[0].length).replace(/;\s*$/, '');
    }
    return JSON.parse(json);
  }

  function applyData(obj) {
    content.texts = obj.texts || [];
    content.images = obj.images || [];
    content.addCards = (obj.addCards || []).map(function (c) { c._type = 'card'; return c; });
    content.addTexts = (obj.addTexts || []).map(function (t) { t._type = 'text'; return t; });
    content.deleteCards = obj.deleteCards || [];
    content.deleteTexts = obj.deleteTexts || [];
    if (obj.passwordHash) content.passwordHash = obj.passwordHash;
    if (obj.usernameHash) content.usernameHash = obj.usernameHash;
    content.seasonCovers = obj.seasonCovers || {};
    applyContent();
    applySeasonCovers();
  }

  function changePassword() {
    var box = openModal(
      '<h3>Cambiar acceso</h3>' +
      '<label class="admin-field">Contraseña actual</label>' +
      '<input type="password" class="admin-input" data-role="old">' +
      '<label class="admin-field">Nuevo usuario</label>' +
      '<input type="text" class="admin-input" data-role="user" placeholder="Ana Avila">' +
      '<label class="admin-field">Nueva contraseña</label>' +
      '<input type="password" class="admin-input" data-role="new">' +
      '<div class="admin-modal-actions">' +
      '<button type="button" class="admin-btn admin-btn-primary" data-role="ok">Guardar</button>' +
      '<button type="button" class="admin-btn" data-role="cancel">Cancelar</button>' +
      '</div>'
    );
    box.querySelector('[data-role="ok"]').addEventListener('click', function () {
      var expected = content.passwordHash || hash(DEFAULT_PASSWORD);
      if (hash(box.querySelector('[data-role="old"]').value) !== expected) {
        toast('Contraseña actual incorrecta.');
        return;
      }
      var nu = box.querySelector('[data-role="user"]').value.trim();
      var nw = box.querySelector('[data-role="new"]').value;
      if (!nu) { toast('Escribe un usuario.'); return; }
      if (nw.length < 5) { toast('La contraseña nueva debe tener al menos 5 caracteres.'); return; }
      content.usernameHash = hash(nu);
      content.passwordHash = hash(nw);
      closeModal();
      autoSave();
      toast('Acceso actualizado.');
    });
    box.querySelector('[data-role="cancel"]').addEventListener('click', function () { closeModal(box); });
  }

  function togglePanel() {
    if (editMode) disableEditMode();
    else enableEditMode();
  }

  /* ---------- recomprimir fotos viejas grandes ---------- */

  function isBigBase64(s) {
    return s && s.indexOf('data:image') === 0 && s.length > 150000;
  }

  function reCompressOld() {
    var changed = false;
    Object.keys(content.seasonCovers || {}).forEach(function (k) {
      var v = content.seasonCovers[k];
      if (isBigBase64(v)) {
        compressImage(v, 1000, 0.55).then(function (c) {
          content.seasonCovers[k] = c;
          autoSave();
        });
        changed = true;
      }
    });
    content.images.forEach(function (im) {
      if (isBigBase64(im.src)) {
        compressImage(im.src, 1000, 0.55).then(function (c) {
          im.src = c;
          autoSave();
        });
        changed = true;
      }
    });
    content.addCards.forEach(function (c) {
      if (isBigBase64(c.img)) {
        compressImage(c.img, 1000, 0.55).then(function (cc) {
          c.img = cc;
          autoSave();
        });
        changed = true;
      }
    });
    if (changed) toast('Fotos antiguas comprimidas para liberar espacio.');
  }

  /* ---------- iniciar ---------- */

  function init() {
    var base = null;
    if (window.ADMIN_CONTENT) {
      try {
        base = JSON.parse(JSON.stringify(window.ADMIN_CONTENT));
      } catch (e) {}
    }
    var saved = loadAutoSave();
    if (saved) {
      try {
        base = mergeData(base || {}, saved);
      } catch (e) {}
    }
    if (base) {
      try { applyData(base); } catch (e) {}
    }
    buildFab();
    reCompressOld();

    setTimeout(applySeasonCovers, 150);

    try {
      if (localStorage.getItem(SESSION_KEY)) {
        authed = true;
        enableEditMode();
        updateFabState();
      }
    } catch (e) {}

    document.addEventListener('click', function (e) {
      var img = e.target.closest ? e.target.closest('img') : null;
      if (!img || !editMode) return;
      if (img.closest('.admin-ui')) return;
      e.stopPropagation();
      e.preventDefault();
      editImage(img);
    }, true);
  }

  function mergeData(base, override) {
    var result = JSON.parse(JSON.stringify(base));
    if (override.texts !== undefined) result.texts = override.texts;
    if (override.images !== undefined) result.images = override.images;
    if (override.addCards !== undefined) result.addCards = override.addCards;
    if (override.addTexts !== undefined) result.addTexts = override.addTexts;
    if (override.deleteCards !== undefined) result.deleteCards = override.deleteCards;
    if (override.deleteTexts !== undefined) result.deleteTexts = override.deleteTexts;
    if (override.seasonCovers !== undefined) result.seasonCovers = override.seasonCovers;
    if (override.passwordHash) result.passwordHash = override.passwordHash;
    if (override.usernameHash) result.usernameHash = override.usernameHash;
    return result;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
