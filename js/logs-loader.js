import { auth, db } from "./firebase-config.js";
import { getDocs, collection, query, where, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

async function obtenerOrganizationId(user) {
  let orgId = localStorage.getItem("currentOrgId");
  if (orgId && orgId !== "undefined" && orgId !== "null") return orgId;

  try {
    if (db && user) {
      const userDocRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userDocRef);
      if (userSnap.exists()) {
        const userData = userSnap.data();
        if (userData.organizationId) {
          localStorage.setItem("currentOrgId", userData.organizationId);
          return userData.organizationId;
        }
      }
    }
  } catch (err) {
    console.warn("No se pudo leer el organizationId del perfil:", err);
  }

  return user.uid;
}

let cacheLogs = [];
const ITEMS_PER_PAGE = 12;
let currentPage = 1;

document.addEventListener("DOMContentLoaded", () => {
  if (!auth) return;

  auth.onAuthStateChanged(async (user) => {
    if (user) {
      await cargarLogs(user);
    }
  });

  const inputBuscar = document.getElementById("inputBuscarLog");
  if (inputBuscar) {
    inputBuscar.addEventListener("input", () => {
      currentPage = 1;
      filtrarYRenderizarLogs(inputBuscar.value);
    });
  }

  const btnActualizar = document.getElementById("btnActualizarLogs");
  if (btnActualizar) {
    btnActualizar.addEventListener("click", async () => {
      if (auth.currentUser) await cargarLogs(auth.currentUser);
    });
  }

  const btnDescargar = document.getElementById("btnDescargarLogs");
  if (btnDescargar) {
    btnDescargar.addEventListener("click", () => {
      validarYConfirmarDescarga();
    });
  }

  const btnAnterior = document.getElementById("btnPaginaAnterior");
  if (btnAnterior) {
    btnAnterior.addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage--;
        const inputBuscar = document.getElementById("inputBuscarLog");
        filtrarYRenderizarLogs(inputBuscar ? inputBuscar.value : "");
      }
    });
  }

  const btnSiguiente = document.getElementById("btnPaginaSiguiente");
  if (btnSiguiente) {
    btnSiguiente.addEventListener("click", () => {
      const inputBuscar = document.getElementById("inputBuscarLog");
      const textoBusqueda = inputBuscar ? inputBuscar.value.toLowerCase().trim() : "";
      const logsFiltrados = cacheLogs.filter(item => {
        const comentario = (item.comentario || "").toLowerCase();
        const correo = (item.correo || "").toLowerCase();
        return comentario.includes(textoBusqueda) || correo.includes(textoBusqueda);
      });
      const totalPages = Math.ceil(logsFiltrados.length / ITEMS_PER_PAGE) || 1;
      
      if (currentPage < totalPages) {
        currentPage++;
        filtrarYRenderizarLogs(inputBuscar ? inputBuscar.value : "");
      }
    });
  }
});

async function cargarLogs(user) {
  const container = document.getElementById("listaLogsConsola");
  if (!container) return;

  container.innerHTML = `<div style="color: var(--text-muted); text-align: center; padding: 2rem; font-family: var(--font-family);">Cargando registros...</div>`;

  try {
    const orgId = await obtenerOrganizationId(user);
    const qLogs = query(collection(db, "logs"), where("organizationId", "==", orgId));
    const snapLogs = await getDocs(qLogs);

    cacheLogs = [];
    snapLogs.forEach(docSnap => {
      cacheLogs.push({ id: docSnap.id, ...docSnap.data() });
    });

    cacheLogs.sort((a, b) => {
      const fechaA = a.fecha?.toDate ? a.fecha.toDate() : new Date(0);
      const fechaB = b.fecha?.toDate ? b.fecha.toDate() : new Date(0);
      return fechaB - fechaA;
    });

    currentPage = 1;
    const inputBuscar = document.getElementById("inputBuscarLog");
    filtrarYRenderizarLogs(inputBuscar ? inputBuscar.value : "");
  } catch (error) {
    console.error("Error al cargar los logs:", error);
    container.innerHTML = `<div style="color: var(--danger); text-align: center; padding: 2rem; font-family: var(--font-family);">Error al cargar los registros.</div>`;
  }
}

function filtrarYRenderizarLogs(filtroTexto) {
    const container = document.getElementById("listaLogsConsola");
    const contadorText = document.getElementById("contadorLogsText");
    const btnAnterior = document.getElementById("btnPaginaAnterior");
    const btnSiguiente = document.getElementById("btnPaginaSiguiente");
    const paginaActualText = document.getElementById("paginaActualText");
    if (!container) return;
 
    const textoBusqueda = (filtroTexto || "").toLowerCase().trim();
 
    const logsFiltrados = cacheLogs.filter(item => {
      const comentario = (item.comentario || "").toLowerCase();
      const correo = (item.correo || "").toLowerCase();
      return comentario.includes(textoBusqueda) || correo.includes(textoBusqueda);
    });
 
    const totalPages = Math.ceil(logsFiltrados.length / ITEMS_PER_PAGE) || 1;
    if (currentPage > totalPages) {
      currentPage = totalPages;
    }
    if (currentPage < 1) {
      currentPage = 1;
    }

    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const logsPagina = logsFiltrados.slice(startIndex, endIndex);

    container.innerHTML = "";
 
    if (logsFiltrados.length === 0) {
      container.innerHTML = `<div style="color: var(--text-muted); text-align: center; padding: 2rem; font-family: var(--font-family);">No se encontraron registros coincidentes.</div>`;
      if (contadorText) contadorText.textContent = `Mostrando 0 de ${cacheLogs.length} registros`;
      if (paginaActualText) paginaActualText.textContent = `Página 1 de 1`;
      if (btnAnterior) btnAnterior.disabled = true;
      if (btnSiguiente) btnSiguiente.disabled = true;
      return;
    }
 
    logsPagina.forEach(item => {
      let fechaStr = "--- -- ---- --:--:--";
      if (item.fecha && item.fecha.toDate) {
        const d = item.fecha.toDate();
        const dia = String(d.getDate()).padStart(2, '0');
        const mes = String(d.getMonth() + 1).padStart(2, '0');
        const anio = d.getFullYear();
        const hora = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        const sec = String(d.getSeconds()).padStart(2, '0');
        fechaStr = `${dia}/${mes}/${anio} ${hora}:${min}:${sec}`;
      }
 
      const correo = item.correo || "sistema@local";
      const comentario = item.comentario || "Sin detalles";
 
      const rowDiv = document.createElement("div");
      rowDiv.style.cssText = "padding: 0.65rem 0.5rem; border-bottom: 1px solid var(--border-color); display: flex; gap: 1rem; align-items: baseline; word-break: break-all; transition: background 0.15s;";
      rowDiv.onmouseover = () => rowDiv.style.backgroundColor = "var(--accent-light)";
      rowDiv.onmouseout = () => rowDiv.style.backgroundColor = "transparent";
 
      rowDiv.innerHTML = `
        <span style="color: var(--text-muted); white-space: nowrap; flex-shrink: 0; font-size: 0.775rem;">${fechaStr}</span>
        <span style="color: var(--accent-primary); font-weight: 600; white-space: nowrap; flex-shrink: 0; font-size: 0.8rem;">[${correo}]</span>
        <span style="color: var(--text-primary); font-size: 0.825rem;">${comentario}</span>
      `;
 
      container.appendChild(rowDiv);
    });
 
    if (contadorText) {
      const startCount = logsFiltrados.length > 0 ? startIndex + 1 : 0;
      const endCount = Math.min(endIndex, logsFiltrados.length);
      contadorText.textContent = `Mostrando del ${startCount} al ${endCount} de ${logsFiltrados.length} registros filtrados (${cacheLogs.length} totales)`;
    }

    if (paginaActualText) {
      paginaActualText.textContent = `Página ${currentPage} de ${totalPages}`;
    }

    if (btnAnterior) {
      btnAnterior.disabled = (currentPage <= 1);
    }
    if (btnSiguiente) {
      btnSiguiente.disabled = (currentPage >= totalPages);
    }
}

function validarYConfirmarDescarga() {
  const inputBuscar = document.getElementById("inputBuscarLog");
  const textoBusqueda = inputBuscar ? inputBuscar.value.toLowerCase().trim() : "";

  const logsExportar = cacheLogs.filter(item => {
    const comentario = (item.comentario || "").toLowerCase();
    const correo = (item.correo || "").toLowerCase();
    return comentario.includes(textoBusqueda) || correo.includes(textoBusqueda);
  });

  // Si no hay registros, mostramos un modal de aviso elegante
  if (logsExportar.length === 0) {
    mostrarModalAlerta("No hay registros disponibles para descargar con los filtros actuales.");
    return;
  }

  // Si sí hay registros, mostramos un modal de confirmación
  mostrarModalConfirmacion(`¿Deseas descargar un archivo .txt con ${logsExportar.length} registro(s)?`, () => {
    ejecutarDescargaTxt(logsExportar);
  });
}

function mostrarModalAlerta(mensaje) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px); z-index: 9999; display: flex; align-items: center; justify-content: center; animation: fadeIn 0.2s ease;";

  const modal = document.createElement("div");
  modal.style.cssText = "background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 1.5rem; width: 100%; max-width: 380px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); text-align: center; display: flex; flex-direction: column; gap: 1rem;";

  modal.innerHTML = `
    <h3 style="color: var(--text-primary); font-size: 1.1rem; font-weight: 700; margin: 0;">Aviso</h3>
    <p style="color: var(--text-secondary); font-size: 0.9rem; margin: 0; line-height: 1.4;">${mensaje}</p>
    <div style="display: flex; justify-content: center; margin-top: 0.5rem;">
      <button type="button" id="btnCerrarModalAlerta" class="btn-secondary" style="padding: 0.5rem 1.25rem; font-size: 0.85rem; width: 100%;">Aceptar</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const cerrar = () => {
    overlay.remove();
  };

  modal.querySelector("#btnCerrarModalAlerta").addEventListener("click", cerrar);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cerrar();
  });
}

function mostrarModalConfirmacion(mensaje, onConfirmar) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px); z-index: 9999; display: flex; align-items: center; justify-content: center; animation: fadeIn 0.2s ease;";

  const modal = document.createElement("div");
  modal.style.cssText = "background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 1.5rem; width: 100%; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); text-align: center; display: flex; flex-direction: column; gap: 1.25rem;";

  modal.innerHTML = `
    <div>
      <h3 style="color: var(--text-primary); font-size: 1.1rem; font-weight: 700; margin-bottom: 0.3rem;">Confirmar descarga</h3>
      <p style="color: var(--text-secondary); font-size: 0.9rem; margin: 0; line-height: 1.4;">${mensaje}</p>
    </div>
    <div style="display: flex; gap: 0.75rem; justify-content: flex-end;">
      <button type="button" id="btnCancelarModal" class="btn-secondary" style="flex: 1; padding: 0.5rem; font-size: 0.85rem;">Cancelar</button>
      <button type="button" id="btnAceptarModal" class="btn-primary" style="flex: 1; padding: 0.5rem; font-size: 0.85rem; background: var(--accent-primary); color: white; border: none; border-radius: var(--radius-md); font-weight: 600; cursor: pointer;">Descargar</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const cerrar = () => {
    overlay.remove();
  };

  modal.querySelector("#btnCancelarModal").addEventListener("click", cerrar);
  modal.querySelector("#btnAceptarModal").addEventListener("click", () => {
    cerrar();
    onConfirmar();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cerrar();
  });
}

function ejecutarDescargaTxt(logsExportar) {
  let contenidoTxt = "";
  logsExportar.forEach(item => {
    let fechaStr = "--- -- ---- --:--:--";
    if (item.fecha && item.fecha.toDate) {
      const d = item.fecha.toDate();
      const dia = String(d.getDate()).padStart(2, '0');
      const mes = String(d.getMonth() + 1).padStart(2, '0');
      const anio = d.getFullYear();
      const hora = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      const sec = String(d.getSeconds()).padStart(2, '0');
      fechaStr = `${dia}/${mes}/${anio} ${hora}:${min}:${sec}`;
    }

    const correo = item.correo || "sistema@local";
    const comentario = item.comentario || "Sin detalles";

    contenidoTxt += `${fechaStr} [${correo}] ${comentario}\n`;
  });

  const blob = new Blob([contenidoTxt], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  
  const fechaActual = new Date().toISOString().slice(0, 10);
  a.download = `logs-sistema-${fechaActual}.txt`;
  
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}