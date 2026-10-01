import { auth, db } from "./firebase-config.js";
import { getDocs, collection, query, where, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, getDoc, Timestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let paginaActual = 1;
const ITEMS_POR_PAGINA = 10;
let movimientosFiltradosCache = [];
let timerModalCreacion = null;
let cacheMovimientos = [];
let cacheConfigSecciones = [];
let cacheConfigTemporadas = [];

function obtenerFechaActualInput() {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = String(hoy.getMonth() + 1).padStart(2, '0');
  const dia = String(hoy.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

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

async function registrarLog(user, comentario) {
  try {
    if (!db || !user) return;
    const orgId = await obtenerOrganizationId(user);
    if (!orgId) return;

    await addDoc(collection(db, "logs"), {
      organizationId: orgId,
      correo: user.email || "Sin correo",
      comentario: comentario,
      fecha: serverTimestamp()
    });
  } catch (err) {
    console.error("Error al registrar el log:", err);
  }
}

function crearModalesConfirmacionDinamicos() {
  if (!document.getElementById("estiloSpinDinamico")) {
    const styleEl = document.createElement("style");
    styleEl.id = "estiloSpinDinamico";
    styleEl.innerHTML = `@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`;
    document.head.appendChild(styleEl);
  }

  if (!document.getElementById("modalAvisoDinamico")) {
    const divModalAviso = document.createElement("div");
    divModalAviso.id = "modalAvisoDinamico";
    divModalAviso.style.cssText = "display: none; align-items: center; justify-content: center; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1050;";
    
    divModalAviso.innerHTML = `
      <div style="background: var(--bg-card, #1e1e1e); padding: 2rem; border-radius: 12px; text-align: center; max-width: 400px; width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <h3 style="margin-bottom: 1rem; color: var(--text-primary, #fff);" id="tituloModalAviso">Aviso</h3>
        <p style="margin-bottom: 1.5rem; color: var(--text-secondary, #aaa);" id="textoModalAviso">Mensaje aquí...</p>
        <button type="button" id="btnCerrarModalAviso" style="background: var(--primary, #3b82f6); color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; cursor: pointer; font-weight: 600;">Aceptar</button>
      </div>
    `;
    document.body.appendChild(divModalAviso);
    document.getElementById("btnCerrarModalAviso").addEventListener("click", () => {
      divModalAviso.style.display = "none";
    });
  }

  if (!document.getElementById("modalConfirmacionEdicion")) {
    const divModalEdicion = document.createElement("div");
    divModalEdicion.id = "modalConfirmacionEdicion";
    divModalEdicion.style.cssText = "display: none; align-items: center; justify-content: center; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000;";
    
    divModalEdicion.innerHTML = `
      <div style="background: var(--bg-card, #1e1e1e); padding: 2rem; border-radius: 12px; text-align: center; max-width: 400px; width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <h3 style="margin-bottom: 1rem; color: var(--text-primary, #fff);">¡Modificación exitosa!</h3>
        <p style="margin-bottom: 1.5rem; color: var(--text-secondary, #aaa);">El movimiento de tesorería se ha actualizado correctamente.</p>
        <button type="button" id="btnCerrarModalConfirmacion" style="background: var(--primary, #3b82f6); color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; cursor: pointer; font-weight: 600;">Aceptar</button>
      </div>
    `;
    document.body.appendChild(divModalEdicion);
    document.getElementById("btnCerrarModalConfirmacion").addEventListener("click", () => {
      divModalEdicion.style.display = "none";
    });
  }

  if (!document.getElementById("modalConfirmacionCreacion")) {
    const divModalCreacion = document.createElement("div");
    divModalCreacion.id = "modalConfirmacionCreacion";
    divModalCreacion.style.cssText = "display: none; align-items: center; justify-content: center; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000;";
    
    divModalCreacion.innerHTML = `
      <div style="background: var(--bg-card, #1e1e1e); padding: 2rem; border-radius: 12px; text-align: center; max-width: 400px; width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <h3 style="margin-bottom: 1rem; color: var(--text-primary, #fff);">¡Ingreso exitoso!</h3>
        <p style="margin-bottom: 1.5rem; color: var(--text-secondary, #aaa);">El nuevo movimiento de tesorería se ha registrado correctamente.</p>
        <button type="button" id="btnCerrarModalCreacion" style="background: var(--primary, #3b82f6); color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; cursor: pointer; font-weight: 600;">Aceptar</button>
      </div>
    `;
    document.body.appendChild(divModalCreacion);
    
    const cerrarModalCreacion = () => {
      divModalCreacion.style.display = "none";
      if (timerModalCreacion) clearTimeout(timerModalCreacion);
    };

    document.getElementById("btnCerrarModalCreacion").addEventListener("click", cerrarModalCreacion);
  }
}

function mostrarModalAviso(mensaje, titulo = "Atención") {
  const modal = document.getElementById("modalAvisoDinamico");
  if (!modal) {
    alert(mensaje);
    return;
  }
  document.getElementById("tituloModalAviso").textContent = titulo;
  document.getElementById("textoModalAviso").textContent = mensaje;
  modal.style.display = "flex";
}

function mostrarModalCreacionExitoso() {
  const modal = document.getElementById("modalConfirmacionCreacion");
  if (!modal) return;
  modal.style.display = "flex";

  if (timerModalCreacion) clearTimeout(timerModalCreacion);
  timerModalCreacion = setTimeout(() => {
    modal.style.display = "none";
  }, 5000);
}

document.addEventListener("DOMContentLoaded", async () => {
  crearModalesConfirmacionDinamicos();

  const fechaActualStr = obtenerFechaActualInput();
  const anioActual = new Date().getFullYear().toString();
  
  const modalFiltroAnio = document.getElementById("modalFiltroAnio");
  if (modalFiltroAnio) modalFiltroAnio.value = anioActual;

  const nuevaFechaEl = document.getElementById("nuevaFecha");
  if (nuevaFechaEl) nuevaFechaEl.value = fechaActualStr;

  if (!auth) return;

  auth.onAuthStateChanged(async (user) => {
    if (user) {
      await cargarConfiguracionYDatos(user);
    }
  });

  const btnAnterior = document.getElementById("btnPaginaAnterior");
  const btnSiguiente = document.getElementById("btnPaginaSiguiente");
  const btnExportarCsv = document.getElementById("btnExportarCsv");
  const btnExportarPdf = document.getElementById("btnExportarPdf");

  if (btnAnterior) {
    btnAnterior.addEventListener("click", () => {
      if (paginaActual > 1) {
        paginaActual--;
        renderizarTablaPaginada();
      }
    });
  }

  if (btnSiguiente) {
    btnSiguiente.addEventListener("click", () => {
      const totalPaginas = Math.ceil(movimientosFiltradosCache.length / ITEMS_POR_PAGINA) || 1;
      if (paginaActual < totalPaginas) {
        paginaActual++;
        renderizarTablaPaginada();
      }
    });
  }

  if (btnExportarCsv) {
    btnExportarCsv.addEventListener("click", () => {
      exportarMovimientosACsv();
    });
  }

  if (btnExportarPdf) {
    btnExportarPdf.addEventListener("click", () => {
      exportarMovimientosAPdf();
    });
  }

  const modal = document.getElementById("modalNuevoMovimiento");
  const btnAbrir = document.getElementById("btnAbrirModalMovimiento");
  const btnCerrar = document.getElementById("btnCerrarModal");

  if (btnAbrir) btnAbrir.addEventListener("click", () => { if (modal) modal.style.display = "flex"; });
  if (btnCerrar) btnCerrar.addEventListener("click", () => { if (modal) modal.style.display = "none"; });

  const modalEditar = document.getElementById("modalEditarMovimiento");
  const btnCerrarEditar = document.getElementById("btnCerrarModalEditar");
  if (btnCerrarEditar) btnCerrarEditar.addEventListener("click", () => { if (modalEditar) modalEditar.style.display = "none"; });

  const modalEliminar = document.getElementById("modalEliminarMovimiento");
  const btnCerrarEliminar = document.getElementById("btnCerrarModalEliminar");
  if (btnCerrarEliminar) btnCerrarEliminar.addEventListener("click", () => { if (modalEliminar) modalEliminar.style.display = "none"; });

  const btnConfirmarEliminar = document.getElementById("btnConfirmarEliminar");
  if (btnConfirmarEliminar) {
    btnConfirmarEliminar.addEventListener("click", async () => {
      const user = auth.currentUser;
      const idMovimiento = document.getElementById("eliminarIdMovimiento").value;
      if (!user || !idMovimiento) return;

      try {
        const movEncontrado = cacheMovimientos.find(m => m.id === idMovimiento);
        const conceptoStr = movEncontrado ? movEncontrado.concept : idMovimiento;

        await deleteDoc(doc(db, "tesoreria", idMovimiento));
        await registrarLog(user, `TESORERÍA: Se ha eliminado el movimiento de tesorería: "${conceptoStr}"`);

        if (modalEliminar) modalEliminar.style.display = "none";
        await cargarConfiguracionYDatos(user);
      } catch (error) {
        console.error("Error al eliminar el movimiento:", error);
        mostrarModalAviso("Hubo un error al eliminar el movimiento.", "Error");
      }
    });
  }

  const modalFiltros = document.getElementById("modalFiltrosAvanzados");
  const btnAbrirFiltros = document.getElementById("btnAbrirModalFiltrosAvanzados");
  const btnCerrarFiltros = document.getElementById("btnCerrarModalFiltros");
  const btnAplicarFiltros = document.getElementById("btnAplicarFiltros");
  const btnResetFiltros = document.getElementById("btnResetFiltros");

  if (btnAbrirFiltros) btnAbrirFiltros.addEventListener("click", () => { if (modalFiltros) modalFiltros.style.display = "flex"; });
  if (btnCerrarFiltros) btnCerrarFiltros.addEventListener("click", () => { if (modalFiltros) modalFiltros.style.display = "none"; });
  
  if (btnAplicarFiltros) {
    btnAplicarFiltros.addEventListener("click", () => {
      if (modalFiltros) modalFiltros.style.display = "none";
      aplicarFiltrosYRenderizar();
    });
  }

  if (btnResetFiltros) {
    btnResetFiltros.addEventListener("click", () => {
      if (document.getElementById("modalFiltroFechaDesde")) document.getElementById("modalFiltroFechaDesde").value = "2026-01-01";
      if (document.getElementById("modalFiltroFechaHasta")) document.getElementById("modalFiltroFechaHasta").value = "2026-12-31";
      if (document.getElementById("modalFiltroAnio")) document.getElementById("modalFiltroAnio").value = new Date().getFullYear().toString();
      if (document.getElementById("modalFiltroMes")) document.getElementById("modalFiltroMes").value = "all";
      if (document.getElementById("modalFiltroSeccion")) document.getElementById("modalFiltroSeccion").value = "all";
      if (document.getElementById("modalFiltroTemporada")) document.getElementById("modalFiltroTemporada").value = "all";
      if (document.getElementById("modalInputBuscarConcepto")) document.getElementById("modalInputBuscarConcepto").value = "";
      if (document.getElementById("inputBuscarConcepto")) document.getElementById("inputBuscarConcepto").value = "";
      aplicarFiltrosYRenderizar();
    });
  }

  const inputBuscarRapido = document.getElementById("inputBuscarConcepto");
  if (inputBuscarRapido) {
    inputBuscarRapido.addEventListener("input", () => {
      const modalInput = document.getElementById("modalInputBuscarConcepto");
      if (modalInput) modalInput.value = inputBuscarRapido.value;
      aplicarFiltrosYRenderizar();
    });
  }

  const modalConfig = document.getElementById("modalConfig");
  const btnAbrirConfig = document.getElementById("btnAbrirModalConfig");
  const btnCerrarConfig = document.getElementById("btnCerrarModalConfig");

  if (btnAbrirConfig) btnAbrirConfig.addEventListener("click", async () => {
    if (modalConfig) {
      modalConfig.style.display = "flex";
      if (auth.currentUser) await renderizarListasConfigModal(auth.currentUser);
    }
  });
  if (btnCerrarConfig) btnCerrarConfig.addEventListener("click", async () => {
    if (modalConfig) {
      modalConfig.style.display = "none";
      if (auth.currentUser) await cargarConfiguracionYDatos(auth.currentUser);
    }
  });

  const btnAddSeccion = document.getElementById("btnAddSeccionConfig");
  if (btnAddSeccion) {
    btnAddSeccion.addEventListener("click", async () => {
      const input = document.getElementById("inputNuevaSeccionConfig");
      const val = input.value.trim();
      if (!val || !auth.currentUser) return;
      await guardarConfigItem(auth.currentUser, "section", val);
      input.value = "";
      await renderizarListasConfigModal(auth.currentUser);
      await cargarConfiguracionYDatos(auth.currentUser);
    });
  }

  const btnAddTemporada = document.getElementById("btnAddTemporadaConfig");
  if (btnAddTemporada) {
    btnAddTemporada.addEventListener("click", async () => {
      const input = document.getElementById("inputNuevaTemporadaConfig");
      const val = input.value.trim();
      if (!val || !auth.currentUser) return;
      await guardarConfigItem(auth.currentUser, "season", val);
      input.value = "";
      await renderizarListasConfigModal(auth.currentUser);
      await cargarConfiguracionYDatos(auth.currentUser);
    });
  }

  const formMovimiento = document.getElementById("formNuevoMovimiento");
  if (formMovimiento) {
    formMovimiento.addEventListener("submit", async (e) => {
      e.preventDefault();
      const user = auth.currentUser;
      if (!user) return;

      const btnSubmit = formMovimiento.querySelector('button[type="submit"]');
      let textoOriginalBtn = btnSubmit ? btnSubmit.innerHTML : "Guardar";

      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = `
          <svg style="animation: spin 1s linear infinite; margin-right: 0.4rem; vertical-align: middle;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
          Guardando...
        `;
      }

      const orgId = await obtenerOrganizationId(user);
      const conceptoVal = document.getElementById("nuevoConcepto").value;
      const fechaValInput = document.getElementById("nuevaFecha").value;
      
      const fechaObj = fechaValInput ? new Date(fechaValInput + "T00:00:00") : new Date();
      const fechaTimestamp = Timestamp.fromDate(fechaObj);

      const nuevoMovimiento = {
        organizationId: orgId,
        concept: conceptoVal,
        type: document.getElementById("nuevoTipo").value,
        amount: parseFloat(document.getElementById("nuevoImporte").value),
        section: document.getElementById("nuevaSeccion").value,
        season: document.getElementById("nuevaTemporada").value,
        status: document.getElementById("nuevoEstado").value,
        date: fechaTimestamp,
        createdAt: serverTimestamp()
      };

      try {
        if (!db) throw new Error("La base de datos (db) no está disponible.");
        await addDoc(collection(db, "tesoreria"), nuevoMovimiento);
        await registrarLog(user, `TESORERÍA: Se ha registrado un nuevo movimiento de tesorería: "${conceptoVal}"`);
        
        if (modal) modal.style.display = "none";
        formMovimiento.reset();
        if (nuevaFechaEl) nuevaFechaEl.value = fechaActualStr;

        await cargarConfiguracionYDatos(user);
        mostrarModalCreacionExitoso();
      } catch (error) {
        console.error("Error al guardar el movimiento:", error);
        mostrarModalAviso("Hubo un error al registrar el movimiento: " + error.message, "Error");
      } finally {
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = textoOriginalBtn;
        }
      }
    });
  }

  const formEditarMovimiento = document.getElementById("formEditarMovimiento");
  if (formEditarMovimiento) {
    formEditarMovimiento.addEventListener("submit", async (e) => {
      e.preventDefault();
      const user = auth.currentUser;
      const idMovimiento = document.getElementById("editarIdMovimiento").value;
      if (!user || !idMovimiento) return;

      const conceptoVal = document.getElementById("editarConcepto").value;
      const fechaValInput = document.getElementById("editarFecha").value;
      
      const fechaObj = fechaValInput ? new Date(fechaValInput + "T00:00:00") : new Date();
      const fechaTimestamp = Timestamp.fromDate(fechaObj);

      const datosActualizados = {
        concept: conceptoVal,
        type: document.getElementById("editarTipo").value,
        amount: parseFloat(document.getElementById("editarImporte").value),
        section: document.getElementById("editarSeccion").value,
        season: document.getElementById("editarTemporada").value,
        status: document.getElementById("editarEstado").value,
        date: fechaTimestamp
      };

      try {
        const docRef = doc(db, "tesoreria", idMovimiento);
        await updateDoc(docRef, datosActualizados);
        await registrarLog(user, `TESORERÍA: Se ha editado el movimiento de tesorería: "${conceptoVal}"`);

        if (modalEditar) modalEditar.style.display = "none";
        
        const modalConfirmacion = document.getElementById("modalConfirmacionEdicion");
        if (modalConfirmacion) modalConfirmacion.style.display = "flex";

        await cargarConfiguracionYDatos(user);
      } catch (error) {
        console.error("Error al actualizar el movimiento:", error);
        mostrarModalAviso("Hubo un error al actualizar el movimiento.", "Error");
      }
    });
  }
});

async function cargarConfiguracionYDatos(user) {
  try {
    if (!db) return;
    const orgId = await obtenerOrganizationId(user);

    const qConfig = query(collection(db, "tesoreria_config"), where("organizationId", "==", orgId));
    const snapConfig = await getDocs(qConfig);

    cacheConfigSecciones = [];
    cacheConfigTemporadas = [];

    snapConfig.forEach(docSnap => {
      const data = docSnap.data();
      if (data.type === "section") cacheConfigSecciones.push({ id: docSnap.id, value: data.value });
      if (data.type === "season") cacheConfigTemporadas.push({ id: docSnap.id, value: data.value });
    });

    const qTeso = query(collection(db, "tesoreria"), where("organizationId", "==", orgId));
    const snapTeso = await getDocs(qTeso);

    cacheMovimientos = [];
    snapTeso.forEach(docSnap => {
      cacheMovimientos.push({ id: docSnap.id, ...docSnap.data() });
    });

    cacheMovimientos.sort((a, b) => {
      const creadoA = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0;
      const creadoB = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0;
      
      if (creadoA !== creadoB) {
        return creadoB - creadoA;
      }
      return (b.id || "").localeCompare(a.id || "");
    });

    actualizarSelectsYListas();
    aplicarFiltrosYRenderizar();
  } catch (error) {
    console.warn("Aviso al cargar configuración y datos:", error);
  }
}

async function guardarConfigItem(user, type, value) {
  const orgId = await obtenerOrganizationId(user);
  try {
    await addDoc(collection(db, "tesoreria_config"), {
      organizationId: orgId,
      type: type,
      value: value
    });

    const tipoTexto = type === "section" ? "actividad" : "temporada";
    await registrarLog(user, `TESORERÍA: Se ha añadido una nueva ${tipoTexto}: "${value}"`);
  } catch (err) {
    console.error("Error al guardar elemento de configuración:", err);
  }
}

async function eliminarConfigItem(docId, user) {
  try {
    const docRef = doc(db, "tesoreria_config", docId);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      const tipoTexto = data.type === "section" ? "actividad" : "temporada";
      const valorStr = data.value || docId;

      await deleteDoc(docRef);
      await registrarLog(user, `TESORERÍA: Se ha eliminado la ${tipoTexto}: "${valorStr}"`);
    } else {
      await deleteDoc(docRef);
    }

    await renderizarListasConfigModal(user);
    await cargarConfiguracionYDatos(user);
  } catch (err) {
    console.error("Error al eliminar elemento:", err);
  }
}

async function renderizarListasConfigModal(user) {
  const orgId = await obtenerOrganizationId(user);
  const qConfig = query(collection(db, "tesoreria_config"), where("organizationId", "==", orgId));
  const snapConfig = await getDocs(qConfig);

  const containerSecciones = document.getElementById("listaSeccionesConfigContainer");
  const containerTemporadas = document.getElementById("listaTemporadasConfigContainer");
  
  if (containerSecciones) containerSecciones.innerHTML = "";
  if (containerTemporadas) containerTemporadas.innerHTML = "";

  snapConfig.forEach(docSnap => {
    const data = docSnap.data();
    const itemDiv = document.createElement("div");
    itemDiv.style.cssText = "display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.05); padding: 0.4rem 0.6rem; border-radius: 6px; font-size: 0.9rem; margin-top: 0.4rem;";
    
    itemDiv.innerHTML = `
      <span>${data.value}</span>
      <button type="button" data-id="${docSnap.id}" class="btn-eliminar-config" style="background: transparent; border: none; color: var(--danger); cursor: pointer; font-size: 0.8rem; font-weight: 600;">Eliminar</button>
    `;

    itemDiv.querySelector("button").addEventListener("click", async () => {
      await eliminarConfigItem(docSnap.id, user);
    });

    if (data.type === "section" && containerSecciones) {
      containerSecciones.appendChild(itemDiv);
    } else if (data.type === "season" && containerTemporadas) {
      containerTemporadas.appendChild(itemDiv);
    }
  });
}

function actualizarSelectsYListas() {
  const seccionesSet = new Set(cacheConfigSecciones.map(item => item.value));
  const temporadasSet = new Set(cacheConfigTemporadas.map(item => item.value));

  cacheMovimientos.forEach(item => {
    if (item.section) seccionesSet.add(item.section.trim());
    if (item.season) temporadasSet.add(item.season.trim());
  });

  const poblarSelect = (elementId, placeholder, isFilter = false, isSeasonFilter = false) => {
    const el = document.getElementById(elementId);
    if (!el) return;
    const valActual = el.value;
    
    if (isFilter) {
      el.innerHTML = `<option value="all">${placeholder}</option>`;
    } else {
      el.innerHTML = `<option value="" disabled selected>${placeholder}</option>`;
    }

    const setSource = isSeasonFilter || elementId.toLowerCase().includes("temporada") ? temporadasSet : seccionesSet;
    setSource.forEach(val => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = isSeasonFilter ? `Temporada ${val}` : val;
      if (val === valActual) opt.selected = true;
      el.appendChild(opt);
    });
  };

  poblarSelect("nuevaSeccion", "Seleccionar Actividad...");
  poblarSelect("nuevaTemporada", "Selecciona temporada...");
  poblarSelect("editarSeccion", "Seleccionar Actividad...");
  poblarSelect("editarTemporada", "Selecciona temporada...");
  poblarSelect("modalFiltroSeccion", "Todas las Actividades", true);
  poblarSelect("modalFiltroTemporada", "Todas las Temporadas", true, true);
}

function aplicarFiltrosYRenderizar() {
  const fechaDesdeStr = document.getElementById("modalFiltroFechaDesde")?.value || "";
  const fechaHastaStr = document.getElementById("modalFiltroFechaHasta")?.value || "";
  const mesFiltro = document.getElementById("modalFiltroMes")?.value || "all";
  const seccionFiltro = document.getElementById("modalFiltroSeccion")?.value || "all";
  const temporadaFiltro = document.getElementById("modalFiltroTemporada")?.value || "all";
  
  const textoBusquedaModal = document.getElementById("modalInputBuscarConcepto")?.value.toLowerCase() || "";
  const textoBusquedaRapido = document.getElementById("inputBuscarConcepto")?.value.toLowerCase() || "";
  const textoBusqueda = textoBusquedaModal || textoBusquedaRapido;

  let fechaDesdeObj = fechaDesdeStr ? new Date(fechaDesdeStr + "T00:00:00") : null;
  let fechaHastaObj = fechaHastaStr ? new Date(fechaHastaStr + "T23:59:59") : null;

  movimientosFiltradosCache = cacheMovimientos.filter(item => {
    let fechaItemDate = null;
    let mesItem = "";
    
    if (item.date && typeof item.date.toDate === "function") {
      fechaItemDate = item.date.toDate();
      mesItem = String(fechaItemDate.getMonth() + 1).padStart(2, '0');
    }

    let matchFechas = true;
    if (fechaItemDate) {
      if (fechaDesdeObj && fechaItemDate < fechaDesdeObj) matchFechas = false;
      if (fechaHastaObj && fechaItemDate > fechaHastaObj) matchFechas = false;
    } else {
      if (fechaDesdeObj || fechaHastaObj) matchFechas = false;
    }

    const matchMes = mesFiltro === "all" || mesItem === mesFiltro;
    const matchSeccion = seccionFiltro === "all" || item.section === seccionFiltro;
    const matchTemporada = temporadaFiltro === "all" || item.season === temporadaFiltro;
    const matchConcepto = !textoBusqueda || (item.concept && item.concept.toLowerCase().includes(textoBusqueda));

    return matchFechas && matchMes && matchSeccion && matchTemporada && matchConcepto;
  });

  paginaActual = 1;
  renderizarTablaPaginada();
  actualizarTextoFiltroActivo();
}

function actualizarTextoFiltroActivo() {
  const spanFiltro = document.getElementById("textoFiltroActivo");
  if (!spanFiltro) return;

  const fechaDesde = document.getElementById("modalFiltroFechaDesde")?.value;
  const fechaHasta = document.getElementById("modalFiltroFechaHasta")?.value;
  const mesSelect = document.getElementById("modalFiltroMes");
  const seccionSelect = document.getElementById("modalFiltroSeccion");
  const temporadaSelect = document.getElementById("modalFiltroTemporada");
  const inputBusqueda = document.getElementById("modalInputBuscarConcepto") || document.getElementById("inputBuscarConcepto");

  let partes = [];

  if (fechaDesde || fechaHasta) {
    partes.push(`Fechas: ${fechaDesde || 'Inicio'} al ${fechaHasta || 'Fin'}`);
  }

  if (mesSelect && mesSelect.value !== "all") {
    partes.push(`Mes: ${mesSelect.options[mesSelect.selectedIndex].text}`);
  }

  if (seccionSelect && seccionSelect.value !== "all") {
    partes.push(`Actividad: ${seccionSelect.value}`);
  }

  if (temporadaSelect && temporadaSelect.value !== "all") {
    partes.push(`Temporada: ${temporadaSelect.value}`);
  }

  if (inputBusqueda && inputBusqueda.value.trim() !== "") {
    partes.push(`Concepto: "${inputBusqueda.value.trim()}"`);
  }

  spanFiltro.textContent = partes.length > 0 ? partes.join(" | ") : "Sin filtros aplicados";
}

function renderizarTablaPaginada() {
  const tbody = document.getElementById("tablaMovimientosBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  let totalIngresos = 0;
  let totalGastos = 0;
  let totalPendiente = 0;

  movimientosFiltradosCache.forEach(item => {
    if (item.status === "paid") {
      if (item.type === "income") totalIngresos += item.amount;
      if (item.type === "expense") totalGastos += item.amount;
    } else if (item.status === "pending") {
      totalPendiente += item.amount;
    }
  });

  actualizarKPIs(totalIngresos, totalGastos, totalPendiente);

  if (movimientosFiltradosCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">No se encontraron movimientos registrados para este filtro.</td></tr>`;
    actualizarControlesPaginacion(0);
    return;
  }

  const totalItems = movimientosFiltradosCache.length;
  const totalPaginas = Math.ceil(totalItems / ITEMS_POR_PAGINA);
  if (paginaActual > totalPaginas) paginaActual = totalPaginas || 1;

  const inicio = (paginaActual - 1) * ITEMS_POR_PAGINA;
  const fin = inicio + ITEMS_POR_PAGINA;
  const movimientosPagina = movimientosFiltradosCache.slice(inicio, fin);

  movimientosPagina.forEach(item => {
    const tr = document.createElement("tr");
    
    let fechaStr = "Reciente";
    if (item.date && item.date.toDate) {
      fechaStr = item.date.toDate().toLocaleDateString();
    }

    const esIngreso = item.type === "income";
    const signoColor = esIngreso ? "var(--success)" : "var(--danger)";
    const signoTexto = esIngreso ? "+ " : "- ";
    const badgeClase = item.status === "paid" ? "active" : "pending";
    const badgeTexto = item.status === "paid" ? "Cobrado / Pagado" : "Pendiente";

    tr.innerHTML = `
      <td>${fechaStr}</td>
      <td><strong>${item.concept}</strong></td>
      <td>${item.section || 'General'}</td>
      <td>${item.season || 'N/D'}</td>
      <td><span style="color: ${signoColor}; font-weight: 600;">${esIngreso ? 'Ingreso' : 'Gasto'}</span></td>
      <td style="font-weight: 700; color: ${signoColor};">${signoTexto}${item.amount.toFixed(2)} €</td>
      <td><span class="badge-status ${badgeClase}">${badgeTexto}</span></td>
      <td style="text-align: right;">
        <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
          <button type="button" class="btn-editar-mov" data-id="${item.id}" style="background: transparent; border: none; cursor: pointer; color: var(--text-secondary);" title="Editar">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <button type="button" class="btn-eliminar-mov" data-id="${item.id}" style="background: transparent; border: none; cursor: pointer; color: var(--danger);" title="Eliminar">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
          </button>
        </div>
      </td>
    `;

    tr.querySelector(".btn-editar-mov").addEventListener("click", () => abrirModalEditar(item));
    tr.querySelector(".btn-eliminar-mov").addEventListener("click", () => abrirModalEliminar(item.id));

    tbody.appendChild(tr);
  });

  actualizarControlesPaginacion(totalItems);
}

function actualizarControlesPaginacion(totalItems) {
  const totalPaginas = Math.ceil(totalItems / ITEMS_POR_PAGINA) || 1;
  const spanInfo = document.getElementById("paginacionInfo");
  const spanActual = document.getElementById("paginacionActual");
  const btnAnterior = document.getElementById("btnPaginaAnterior");
  const btnSiguiente = document.getElementById("btnPaginaSiguiente");

  if (spanInfo) {
    const inicio = totalItems === 0 ? 0 : (paginaActual - 1) * ITEMS_POR_PAGINA + 1;
    const fin = Math.min(paginaActual * ITEMS_POR_PAGINA, totalItems);
    spanInfo.textContent = `Mostrando ${inicio}-${fin} de ${totalItems} movimientos`;
  }

  if (spanActual) spanActual.textContent = `Página ${paginaActual} de ${totalPaginas}`;
  if (btnAnterior) btnAnterior.disabled = paginaActual <= 1;
  if (btnSiguiente) btnSiguiente.disabled = paginaActual >= totalPaginas;
}

function exportarMovimientosACsv() {
  if (!movimientosFiltradosCache || movimientosFiltradosCache.length === 0) {
    mostrarModalAviso("No hay datos para exportar con el filtro actual.", "Exportar CSV");
    return;
  }

  let csvContent = "\uFEFFFecha;Concepto;Sección;Temporada;Tipo;Importe (€);Estado\n";

  movimientosFiltradosCache.forEach(item => {
    let fechaStr = "";
    if (item.date && item.date.toDate) {
      fechaStr = item.date.toDate().toLocaleDateString();
    }

    const concepto = `"${(item.concept || "").replace(/"/g, '""')}"`;
    const seccion = `"${(item.section || "General").replace(/"/g, '""')}"`;
    const temporada = `"${(item.season || "N/D").replace(/"/g, '""')}"`;
    const tipo = item.type === "income" ? "Ingreso" : "Gasto";
    const importe = (item.amount || 0).toFixed(2).replace('.', ',');
    const estado = item.status === "paid" ? "Cobrado/Pagado" : "Pendiente";

    csvContent += `${fechaStr};${concepto};${seccion};${temporada};${tipo};${importe};${estado}\n`;
  });

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `tesoreria_export_${obtenerFechaActualInput()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function asegurarCargaJsPDF() {
  if (window.jspdf && window.jspdf.jsPDF) return;
  await new Promise((resolve, reject) => {
    const script1 = document.createElement("script");
    script1.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script1.onload = () => {
      const script2 = document.createElement("script");
      script2.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";
      script2.onload = resolve;
      script2.onerror = reject;
      document.head.appendChild(script2);
    };
    script1.onerror = reject;
    document.head.appendChild(script1);
  });
}

async function exportarMovimientosAPdf() {
  if (!movimientosFiltradosCache || movimientosFiltradosCache.length === 0) {
    mostrarModalAviso("No hay datos para exportar a PDF con el filtro actual.", "Exportar PDF");
    return;
  }

  try {
    await asegurarCargaJsPDF();
  } catch (err) {
    mostrarModalAviso("No se pudo cargar la librería para generar el PDF. Comprueba tu conexión a internet.", "Error de Conexión");
    return;
  }

  const { jsPDF } = window.jspdf;
  const docPdf = new jsPDF();

  const fechaDesdeVal = document.getElementById("modalFiltroFechaDesde")?.value || "";
  const fechaHastaVal = document.getElementById("modalFiltroFechaHasta")?.value || "";
  const anioVal = fechaDesdeVal ? fechaDesdeVal.substring(0, 4) : new Date().getFullYear().toString();

  const mesSelect = document.getElementById("modalFiltroMes");
  const mesVal = mesSelect && mesSelect.value !== "all" ? mesSelect.options[mesSelect.selectedIndex].text : "Todos";
  
  const seccionSelect = document.getElementById("modalFiltroSeccion");
  const seccionVal = seccionSelect && seccionSelect.value !== "all" ? seccionSelect.value : "Todos";
  
  const temporadaSelect = document.getElementById("modalFiltroTemporada");
  const temporadaVal = temporadaSelect && temporadaSelect.value !== "all" ? temporadaSelect.value : "Todos";
  
  const fechaEmision = new Date().toLocaleDateString();

  docPdf.setFont("helvetica", "bold");
  docPdf.setFontSize(14);
  docPdf.text(`RESUMEN DE INGRESOS Y GASTOS - Ejercicio: ${anioVal}`, 14, 15);

  docPdf.setFont("helvetica", "normal");
  docPdf.setFontSize(9);
  const lineaFiltros = `Emisión: ${fechaEmision} | Rango: ${fechaDesdeVal || 'Inicio'} a ${fechaHastaVal || 'Fin'} | Mes: ${mesVal} | Actividad: ${seccionVal} | Temporada: ${temporadaVal}`;
  docPdf.text(lineaFiltros, 14, 23);

  docPdf.setLineWidth(0.5);
  docPdf.line(14, 27, 196, 27);

  const ingresosList = [];
  const gastosList = [];
  let sumaIngresos = 0;
  let sumaGastos = 0;

  movimientosFiltradosCache.forEach(item => {
    let fechaStr = "N/D";
    if (item.date && item.date.toDate) {
      fechaStr = item.date.toDate().toLocaleDateString();
    }
    const concepto = item.concept || "";
    const seccion = item.section || "General";
    const temporada = item.season || "N/D";
    const estado = item.status === "paid" ? "Cobrado/Pagado" : "Pendiente";
    const importe = item.amount || 0;

    const fila = [fechaStr, concepto, seccion, temporada, estado, `${importe.toFixed(2)} €`];

    if (item.type === "income") {
      ingresosList.push(fila);
      if (item.status === "paid") sumaIngresos += importe;
    } else {
      gastosList.push(fila);
      if (item.status === "paid") sumaGastos += importe;
    }
  });

  let currentY = 33;

  docPdf.setFont("helvetica", "bold");
  docPdf.setFontSize(12);
  docPdf.setTextColor(16, 185, 129);
  docPdf.text("INGRESOS", 14, currentY);
  currentY += 4;

  docPdf.autoTable({
    startY: currentY,
    head: [["Fecha", "Concepto", "Actividad", "Temporada", "Estado", "Importe"]],
    body: ingresosList.length > 0 ? ingresosList : [["-", "No hay ingresos registrados", "-", "-", "-", "0.00 €"]],
    theme: "grid",
    headStyles: { fillColor: [16, 185, 129] },
    styles: { fontSize: 9 },
    columnStyles: { 5: { halign: 'right', fontStyle: 'bold' } }
  });

  currentY = docPdf.lastAutoTable.finalY + 6;
  docPdf.setFont("helvetica", "bold");
  docPdf.setFontSize(10);
  docPdf.setTextColor(0, 0, 0);
  docPdf.text(`TOTAL INGRESOS: ${sumaIngresos.toFixed(2)} €`, 14, currentY);

  currentY += 10;

  docPdf.setFont("helvetica", "bold");
  docPdf.setFontSize(12);
  docPdf.setTextColor(220, 38, 38);
  docPdf.text("GASTOS", 14, currentY);
  currentY += 4;

  docPdf.autoTable({
    startY: currentY,
    head: [["Fecha", "Concepto", "Actividad", "Temporada", "Estado", "Importe"]],
    body: gastosList.length > 0 ? gastosList : [["-", "No hay gastos registrados", "-", "-", "-", "0.00 €"]],
    theme: "grid",
    headStyles: { fillColor: [220, 38, 38] },
    styles: { fontSize: 9 },
    columnStyles: { 5: { halign: 'right', fontStyle: 'bold' } }
  });

  currentY = docPdf.lastAutoTable.finalY + 6;
  docPdf.setFont("helvetica", "bold");
  docPdf.setFontSize(10);
  docPdf.setTextColor(0, 0, 0);
  docPdf.text(`TOTAL GASTOS: ${sumaGastos.toFixed(2)} €`, 14, currentY);

  currentY += 12;

  const diferencia = sumaIngresos - sumaGastos;
  
  docPdf.setFillColor(243, 244, 246);
  docPdf.rect(14, currentY, 182, 12, "F");
  
  docPdf.setFont("helvetica", "bold");
  docPdf.setFontSize(11);
  docPdf.text(`RESULTADO (Total Ingresos - Total Gastos):`, 18, currentY + 8);
  
  docPdf.setTextColor(diferencia >= 0 ? 16 : 220, diferencia >= 0 ? 185 : 38, diferencia >= 0 ? 129 : 38);
  docPdf.text(`${diferencia.toFixed(2)} €`, 160, currentY + 8, { align: 'right' });

  const pageCount = docPdf.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    docPdf.setPage(i);
    docPdf.setFont("helvetica", "normal");
    docPdf.setFontSize(8);
    docPdf.setTextColor(120, 120, 120);
    docPdf.text(`Página ${i} de ${pageCount}`, 196, 290, { align: 'right' });
  }

  docPdf.save(`resumen_tesoreria_${anioVal}_${obtenerFechaActualInput()}.pdf`);
}

function abrirModalEditar(item) {
  const modalEditar = document.getElementById("modalEditarMovimiento");
  if (!modalEditar) return;

  document.getElementById("editarIdMovimiento").value = item.id;
  document.getElementById("editarConcepto").value = item.concept || "";
  document.getElementById("editarTipo").value = item.type || "income";
  document.getElementById("editarImporte").value = item.amount || 0;
  document.getElementById("editarSeccion").value = item.section || "";
  document.getElementById("editarTemporada").value = item.season || "";
  document.getElementById("editarEstado").value = item.status || "paid";

  let fechaInputStr = obtenerFechaActualInput();
  if (item.date && item.date.toDate) {
    const d = item.date.toDate();
    const anio = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    fechaInputStr = `${anio}-${mes}-${dia}`;
  }
  document.getElementById("editarFecha").value = fechaInputStr;

  modalEditar.style.display = "flex";
}

function abrirModalEliminar(id) {
  const modalEliminar = document.getElementById("modalEliminarMovimiento");
  if (!modalEliminar) return;

  document.getElementById("eliminarIdMovimiento").value = id;
  modalEliminar.style.display = "flex";
}

function actualizarKPIs(ingresos, gastos, pendiente) {
  const balance = ingresos - gastos;
  
  const elBalance = document.getElementById("kpiBalance");
  if (elBalance) {
    elBalance.textContent = balance.toFixed(2) + " €";
    elBalance.style.color = balance >= 0 ? "var(--text-primary)" : "var(--danger)";
  }

  const elIngresos = document.getElementById("kpiIngresos");
  if (elIngresos) elIngresos.textContent = ingresos.toFixed(2) + " €";

  const elGastos = document.getElementById("kpiGastos");
  if (elGastos) elGastos.textContent = gastos.toFixed(2) + " €";

  const elPendiente = document.getElementById("kpiPendiente");
  if (elPendiente) elPendiente.textContent = pendiente.toFixed(2) + " €";
}