/* =========================================================
   Віртуальне портфоліо (A-Frame) — єдиний шаблон
   ========================================================= */

const CONFIG_PATH = "./config/config.json";
const $ = (sel) => document.querySelector(sel);

/** Компонент: Блокування руху крізь вертикальні площини (COLLIDER) */
AFRAME.registerComponent('wall-collider', {
  init: function () {
    this.raycaster = new THREE.Raycaster();
    this.colliders = [];
    this.playerRadius = 0.4; // Запас дистанції (відштовхування від стіни)
    this.initialized = false;
    this.lastLocalPos = new THREE.Vector3();
    this.rigObj = document.querySelector('#rig').object3D;
  },
  tick: function () {
    if (this.colliders.length === 0) return;

    const localPos = this.el.object3D.position;

    // Ініціалізація початкової безпечної точки
    if (!this.initialized) {
      this.lastLocalPos.copy(localPos);
      this.initialized = true;
      return;
    }

    // Розрахунок спроби кроку
    const delta = new THREE.Vector3().subVectors(localPos, this.lastLocalPos);
    delta.y = 0; // Ігноруємо зміни висоти (стрибки)

    if (delta.length() < 0.001) {
      this.lastLocalPos.copy(localPos);
      return;
    }

    // Примусово оновлюємо матриці простору для точності
    this.el.object3D.updateMatrixWorld(true);
    this.rigObj.updateMatrixWorld(true);

    // Безпечний перевід локальних координат у світові через математичну матрицю батька (#rig)
    const startWorldPos = this.lastLocalPos.clone();
    startWorldPos.applyMatrix4(this.rigObj.matrixWorld);
    startWorldPos.y -= 0.5; // Опускаємо промінь на рівень грудей

    const endWorldPos = localPos.clone();
    endWorldPos.applyMatrix4(this.rigObj.matrixWorld);
    endWorldPos.y -= 0.5;

    // Світовий вектор руху
    const worldDelta = new THREE.Vector3().subVectors(endWorldPos, startWorldPos);
    worldDelta.y = 0;
    
    const distance = worldDelta.length();
    const direction = worldDelta.normalize();

    // Запуск променя
    this.raycaster.set(startWorldPos, direction);
    const hits = this.raycaster.intersectObjects(this.colliders, true);

    // Якщо відстань до стіни менша за (довжина кроку + радіус тіла) — блокуємо
    if (hits.length > 0 && hits[0].distance < (distance + this.playerRadius)) {
      localPos.copy(this.lastLocalPos); // Відкидаємо камеру назад
    } else {
      this.lastLocalPos.copy(localPos); // Крок легальний, зберігаємо позицію
    }
  }
});

const ui = {
  panel: $("#infoPanel"),
  title: $("#infoTitle"),
  meta: $("#infoMeta"),
  desc: $("#infoDesc"),
  closeBtn: $("#closeInfo"),
  open(work) {
    this.title.textContent = work.TITLE || work.WORK_ID || "Без назви";
    const metaParts = [];
    if (work.AUTHOR) metaParts.push(work.AUTHOR);
    if (work.YEAR) metaParts.push(String(work.YEAR));
    if (work.TECHNIQUE) metaParts.push(work.TECHNIQUE);
    this.meta.textContent = metaParts.join(" · ") || "—";
    this.desc.textContent = work.DESCRIPTION || "—";
    this.panel.style.display = "block";
  },
  close() {
    this.panel.style.display = "none";
  }
};

ui.closeBtn.addEventListener("click", () => ui.close());

async function loadConfig() {
  const res = await fetch(CONFIG_PATH, { cache: "no-store" });
  if (!res.ok) throw new Error(`Не вдалося завантажити config. Статус: ${res.status}`);
  return await res.json();
}

function warnIfNotUppercaseKeys(obj, prefix = "ROOT") {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => warnIfNotUppercaseKeys(v, `${prefix}[${i}]`));
    return;
  }
  for (const k of Object.keys(obj)) {
    if (k !== k.toUpperCase()) console.warn(`[CONFIG] Ключ не UPPERCASE: ${prefix}.${k}`);
    warnIfNotUppercaseKeys(obj[k], `${prefix}.${k}`);
  }
}

function loadImageInfo(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error(`Зображення не знайдено: ${url}`));
    img.src = url;
  });
}

function computeContainSize(innerW, innerH, imgW, imgH) {
  const innerAspect = innerW / innerH;
  const imgAspect = imgW / imgH;
  if (imgAspect >= innerAspect) return { w: innerW, h: innerW / imgAspect };
  return { w: innerH * imgAspect, h: innerH };
}

function getByName(root3D, name) {
  return root3D.getObjectByName(name);
}

function ensureUniqueMaterial(mesh) {
  if (!mesh || !mesh.material) return;
  if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(m => m.clone());
  else mesh.material = mesh.material.clone();
}

async function applyMaterialOverride(mesh, override) {
  if (!mesh || !mesh.material) return;
  ensureUniqueMaterial(mesh);
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const colorHex = override.COLOR || null;
  const metalness = override.METALNESS;
  const roughness = override.ROUGHNESS;
  const mapPath = override.TEXTURE || null;
  const targetIndex = typeof override.MATERIAL_INDEX === "number" ? override.MATERIAL_INDEX : null;

  for (let i = 0; i < mats.length; i++) {
    if (targetIndex !== null && i !== targetIndex) continue;
    const m = mats[i];
    if (colorHex && m.color) m.color.set(colorHex);
    if (typeof metalness === "number" && "metalness" in m) m.metalness = metalness;
    if (typeof roughness === "number" && "roughness" in m) m.roughness = roughness;

    if (mapPath) {
      const tex = await new Promise((resolve, reject) => {
        new THREE.TextureLoader().load(mapPath, resolve, undefined, reject);
      });
      tex.colorSpace = THREE.SRGBColorSpace;
      if (override.REPEAT && Array.isArray(override.REPEAT) && override.REPEAT.length === 2) {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(override.REPEAT[0], override.REPEAT[1]);
      }
      m.map = tex;
      m.needsUpdate = true;
    }
  }
}

function buildLightsFromConfig(cfg) {
  const lightsRoot = $("#lights");
  lightsRoot.innerHTML = "";
  const arr = cfg?.LIGHTS?.LIST;
  if (!Array.isArray(arr) || arr.length === 0) return;

  arr.forEach((L) => {
    const e = document.createElement("a-entity");
    const type = (L.TYPE || "point").toLowerCase();
    const color = L.COLOR || "#ffffff";
    const intensity = typeof L.INTENSITY === "number" ? L.INTENSITY : 1.0;
    const distance = typeof L.DISTANCE === "number" ? L.DISTANCE : 0.0;
    const decay = typeof L.DECAY === "number" ? L.DECAY : 2.0;
    const angle = typeof L.ANGLE === "number" ? L.ANGLE : 45;
    const penumbra = typeof L.PENUMBRA === "number" ? L.PENUMBRA : 0.2;

    let lightStr = `type: ${type}; color: ${color}; intensity: ${intensity};`;
    if (type === "point" || type === "spot") lightStr += ` distance: ${distance}; decay: ${decay};`;
    if (type === "spot") lightStr += ` angle: ${THREE.MathUtils.degToRad(angle)}; penumbra: ${penumbra};`;

    e.setAttribute("light", lightStr);
    const p = L.POSITION || [0, 3, 0];
    const r = L.ROTATION || [0, 0, 0];
    e.setAttribute("position", `${p[0]} ${p[1]} ${p[2]}`);
    e.setAttribute("rotation", `${r[0]} ${r[1]} ${r[2]}`);
    lightsRoot.appendChild(e);
  });
}

function loadRoom(cfg) {
  const room = $("#room");
  const glbPath = cfg?.ROOM?.GLB_PATH || "./assets/room.glb";
  const pos = cfg?.ROOM?.POSITION || [0,0,0];
  const rot = cfg?.ROOM?.ROTATION || [0,0,0];
  const scale = cfg?.ROOM?.SCALE ?? 1;

  room.setAttribute("gltf-model", `url(${glbPath})`);
  room.setAttribute("position", `${pos[0]} ${pos[1]} ${pos[2]}`);
  room.setAttribute("rotation", `${rot[0]} ${rot[1]} ${rot[2]}`);
  room.setAttribute("scale", `${scale} ${scale} ${scale}`);
  return room;
}

async function applyMaterialOverrides(root3D, cfg) {
  const list = cfg?.MATERIAL_OVERRIDES;
  if (!Array.isArray(list) || list.length === 0) return;

  root3D.traverse(async (obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const ov of list) {
      const targetName = ov.MATERIAL_NAME;
      if (!targetName) continue;
      if (typeof ov.MATERIAL_INDEX === "number") {
        const idx = ov.MATERIAL_INDEX;
        if (mats[idx] && mats[idx].name === targetName) await applyMaterialOverride(obj, ov);
        continue;
      }
      if (mats.some(m => m?.name === targetName)) await applyMaterialOverride(obj, ov);
    }
  });
}

async function buildWorks(root3D, cfg) {
  const slots = cfg?.SLOTS;
  const works = cfg?.WORKS;
  if (!Array.isArray(slots) || slots.length === 0) return;
  if (!Array.isArray(works) || works.length === 0) return;

  const slotById = new Map(slots.map(s => [s.SLOT_ID, s]));

  for (let i = 0; i < works.length; i++) {
    const work = works[i];
    const slotId = work.SLOT_ID || slots[i]?.SLOT_ID;
    if (!slotId) continue;

    const slot = slotById.get(slotId);
    if (!slot) continue;

    const hookName = slot.HOOK_NAME;
    const hookObj = getByName(root3D, hookName);
    if (!hookObj) continue;

    const imgUrl = `./works/${work.FILE}`;
    let imgInfo = null;
    try { imgInfo = await loadImageInfo(imgUrl); } catch (e) { continue; }

    const innerW = Number(slot.INNER_W || 1.0);
    const innerH = Number(slot.INNER_H || 1.0);
    const size = computeContainSize(innerW, innerH, imgInfo.width, imgInfo.height);

    const plane = document.createElement("a-plane");
    plane.classList.add("clickable");
    plane.setAttribute("width", size.w);
    plane.setAttribute("height", size.h);
    plane.setAttribute("material", `src: url(${imgUrl}); shader: standard; transparent: true; metalness: 0.0; roughness: 1.0;`);
    plane.setAttribute("geometry", "primitive: plane");

    const offset = Number(slot.IMAGE_OFFSET || 0.01);
    const wp = new THREE.Vector3();
    const wq = new THREE.Quaternion();
    hookObj.getWorldPosition(wp);
    hookObj.getWorldQuaternion(wq);

    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(wq);
    const finalPos = wp.clone().add(forward.multiplyScalar(offset));
    plane.setAttribute("position", `${finalPos.x} ${finalPos.y} ${finalPos.z}`);

    const euler = new THREE.Euler().setFromQuaternion(wq, "YXZ");
    plane.setAttribute("rotation", `${THREE.MathUtils.radToDeg(euler.x)} ${THREE.MathUtils.radToDeg(euler.y)} ${THREE.MathUtils.radToDeg(euler.z)}`);

    plane.addEventListener("click", () => ui.open(work));
    $("a-scene").appendChild(plane);
  }
}

function basicComplianceChecks(cfg) {
  (cfg?.WORKS || []).forEach(w => {
    if (w.FILE && w.FILE !== w.FILE.toUpperCase()) console.warn(`[WORK FILE] Файл не UPPERCASE: ${w.FILE}`);
  });
}

function setupEnvironment(cfg) {
  const envPath = cfg?.ENVIRONMENT?.MAP_PATH;
  if (!envPath) return;
  const sceneEl = $("a-scene");
  if (!sceneEl) return;
  const intensity = typeof cfg?.ENVIRONMENT?.INTENSITY === "number" ? cfg?.ENVIRONMENT?.INTENSITY : 1.0;

  new THREE.TextureLoader().load(envPath, (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    sceneEl.object3D.environment = texture;
    if ("environmentIntensity" in sceneEl.object3D) sceneEl.object3D.environmentIntensity = intensity;
  });
}

(async function main() {
  try {
    const cfg = await loadConfig();
    warnIfNotUppercaseKeys(cfg);
    basicComplianceChecks(cfg);

    setupEnvironment(cfg);
    buildLightsFromConfig(cfg);

    const cam = $("#camera");
    const rig = $("#rig");
    const playerH = cfg?.PLAYER?.HEIGHT ?? 1.65;
    const start = cfg?.PLAYER?.START_POSITION || [0, 0, 0];
    
    // Встановлення базових позицій з config.json
    cam.setAttribute("position", `0 ${playerH} 0`);
    rig.setAttribute("position", `${start[0]} ${start[1]} ${start[2]}`);

    const room = loadRoom(cfg);

    room.addEventListener("model-loaded", async () => {
      const root3D = room.getObject3D("mesh");
      if (!root3D) return;

      // 4.0) Збір вертикальних об'єктів-коллайдерів
      const colliderSystem = cam.components['wall-collider'];
      
      root3D.traverse(child => {
        if (child.name && child.name.toUpperCase().includes("COLLIDER")) {
          child.visible = false; // Робимо стіни невидимими для глядача, але відчутними для променя
          if (colliderSystem) colliderSystem.colliders.push(child);
        }
      });

      if (colliderSystem && colliderSystem.colliders.length === 0) {
        console.warn("[COLLIDER] Об'єкти з назвою 'COLLIDER' не знайдені. Рух не обмежено.");
      }

      await applyMaterialOverrides(root3D, cfg);
      await buildWorks(root3D, cfg);

      console.log("✅ Шаблон портфоліо готовий (вертикальні стіни активні)");
    });

  } catch (e) {
    console.error(e);
  }
})();