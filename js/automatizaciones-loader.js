import { db, auth } from "./firebase-config.js"; 
import { 
  collection, 
  getDocs, 
  doc, 
  getDoc, 
  addDoc, 
  deleteDoc,
  query, 
  where,
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

let currentUserOrgId = null;
let sociosCache = [];
let idsSeleccionados = new Set();

// Variables de Paginación y Filtrado (Socios - Pagos Masivos)
let paginaActual = 1;
const filasPorPagina = 8;
let sociosFiltradosCache = [];

// Variables para el Módulo de Eliminación de Pagos
let pagosCache = [];
let idsPagosSeleccionados = new Set();
let paginaActualPagos = 1;
const filasPorPaginaPagos = 8;
let pagosFiltradosCache = [];

// Variables para el Módulo de Eliminación Masiva de Usuarios
let idsUsuariosSeleccionados = new Set();
let paginaActualUsuarios = 1;
const filasPorPaginaUsuarios = 8;
let usuariosFiltradosCache = [];

// Variables para el Módulo de Información de Usuarios y Federados
let infoUsuariosCache = [];
let federadosCache = []; // Caché específica para deportistas federados
let paginaActualInfo = 1;
const filasPorPaginaInfo = 8;

// ==========================================
// FUNCIÓN AUXILIAR DE LOGS (CON TIMESTAMP)
// ==========================================
async function registrarLog(comentario) {
  try {
    const user = auth.currentUser;
    const correo = user && user.email ? user.email : "Desconocido";

    await addDoc(collection(db, "logs"), {
      comentario: comentario,
      correo: correo,
      fecha: serverTimestamp(),
      organizationId: currentUserOrgId || null
    });
  } catch (error) {
    console.error("Error al registrar el log:", error);
  }
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const userDocRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        console.error("No se encontró el documento del usuario en Firestore.");
        return;
      }

      const userData = userDoc.data();
      currentUserOrgId = userData.organizationId || userData.orgId || userData.companyId;

      if (!currentUserOrgId) {
        console.error("El usuario no tiene una organización asignada.");
        return;
      }

      await cargarConceptos(currentUserOrgId);
      await cargarSocios(currentUserOrgId);
      await cargarPagos(currentUserOrgId);
      await cargarFederados(currentUserOrgId); // Carga inicial de federados

    } catch (error) {
      console.error("Error al autenticar o cargar datos iniciales:", error);
    }
  } else {
    window.location.href = "./index.html";
  }
});

document.addEventListener("DOMContentLoaded", () => {
  if (!document.getElementById("estilosModalEleganteGlobal")) {
    const style = document.createElement("style");
    style.id = "estilosModalEleganteGlobal";
    style.innerHTML = `
      .modal-overlay-elegante {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.65);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        z-index: 1400;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        opacity: 0;
        transition: opacity 0.25s ease;
      }
      .modal-overlay-elegante.activo {
        display: flex !important;
        opacity: 1;
      }
      .modal-card-elegante {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        width: 100%;
        max-width: 420px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        transform: scale(0.95) translateY(10px);
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
        opacity: 0;
        padding: 2rem;
        text-align: center;
        position: relative;
      }
      .modal-overlay-elegante.activo .modal-card-elegante {
        transform: scale(1) translateY(0);
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }

  // ==========================================
  // MODAL 1: PAGOS MASIVOS
  // ==========================================
  const modalPagos = document.getElementById("modalPagosMasivos");
  const btnAbrirModal = document.getElementById("btnAbrirModalPagos");
  const btnCerrarModal = document.getElementById("btnCerrarModalPagos");
  const btnCancelarModal = document.getElementById("btnCancelarModalPagos");

  function abrirModalPagos() {
    if (modalPagos) {
      modalPagos.style.display = "flex";
      requestAnimationFrame(() => modalPagos.classList.add("activo"));
    }
  }

  function cerrarModalPagos() {
    if (modalPagos) {
      modalPagos.classList.remove("activo");
      setTimeout(() => { 
        modalPagos.style.display = "none"; 
        
        const inputBuscarDni = document.getElementById("inputBuscarDni");
        if (inputBuscarDni) inputBuscarDni.value = "";
        
        sociosFiltradosCache = [...sociosCache];
        paginaActual = 1;
        renderizarTablaSocios();
      }, 250);
    }
  }

  if (btnAbrirModal) btnAbrirModal.addEventListener("click", abrirModalPagos);
  if (btnCerrarModal) btnCerrarModal.addEventListener("click", cerrarModalPagos);
  if (btnCancelarModal) btnCancelarModal.addEventListener("click", cerrarModalPagos);
  
  if (modalPagos) {
    modalPagos.addEventListener("click", (e) => {
      if (e.target === modalPagos) cerrarModalPagos();
    });
  }

  const selectConcepto = document.getElementById("autoSelectConcepto");
  const inputFecha = document.getElementById("autoFechaPago");
  const checkboxCabecera = document.getElementById("checkboxCabecera");
  const btnSeleccionarTodos = document.getElementById("btnSeleccionarTodos");
  const btnEjecutarCobros = document.getElementById("btnEjecutarCobrosMasivos");
  const inputBuscarDni = document.getElementById("inputBuscarDni");
  const btnPaginaAnterior = document.getElementById("btnPaginaAnterior");
  const btnPaginaSiguiente = document.getElementById("btnPaginaSiguiente");

  const hoy = new Date().toISOString().split("T")[0];
  if (inputFecha) inputFecha.value = hoy;

  if (inputBuscarDni) {
    inputBuscarDni.addEventListener("input", (e) => {
      const termino = e.target.value.toLowerCase().trim();
      sociosFiltradosCache = sociosCache.filter(socio => {
        const dniSocio = (socio.dni || socio.nif || "").toLowerCase();
        const nombreSocio = (socio.nombre || socio.nombreCompleto || "").toLowerCase();
        return dniSocio.includes(termino) || nombreSocio.includes(termino);
      });
      paginaActual = 1;
      renderizarTablaSocios();
    });
  }

  if (btnPaginaAnterior) {
    btnPaginaAnterior.addEventListener("click", () => {
      if (paginaActual > 1) {
        paginaActual--;
        renderizarTablaSocios();
      }
    });
  }

  if (btnPaginaSiguiente) {
    btnPaginaSiguiente.addEventListener("click", () => {
      const totalPaginas = Math.ceil(sociosFiltradosCache.length / filasPorPagina) || 1;
      if (paginaActual < totalPaginas) {
        paginaActual++;
        renderizarTablaSocios();
      }
    });
  }

  if (btnSeleccionarTodos) {
    btnSeleccionarTodos.addEventListener("click", () => {
      const inicio = (paginaActual - 1) * filasPorPagina;
      const fin = inicio + filasPorPagina;
      const sociosPagina = sociosFiltradosCache.slice(inicio, fin);
      const todosMarcadosEnPagina = sociosPagina.every(s => idsSeleccionados.has(s.id));

      sociosPagina.forEach(s => {
        if (todosMarcadosEnPagina) {
          idsSeleccionados.delete(s.id);
        } else {
          idsSeleccionados.add(s.id);
        }
      });
      renderizarTablaSocios();
    });
  }

  if (checkboxCabecera) {
    checkboxCabecera.addEventListener("change", (e) => {
      const inicio = (paginaActual - 1) * filasPorPagina;
      const fin = inicio + filasPorPagina;
      const sociosPagina = sociosFiltradosCache.slice(inicio, fin);

      sociosPagina.forEach(s => {
        if (e.target.checked) {
          idsSeleccionados.add(s.id);
        } else {
          idsSeleccionados.delete(s.id);
        }
      });
      renderizarTablaSocios();
    });
  }

  if (btnEjecutarCobros) {
    btnEjecutarCobros.addEventListener("click", async () => {
      const selectConceptoEl = document.getElementById("autoSelectConcepto");
      const inputFechaEl = document.getElementById("autoFechaPago");
      const conceptId = selectConceptoEl ? selectConceptoEl.value : "";
      const fechaPago = inputFechaEl ? inputFechaEl.value : "";

      if (!conceptId) {
        mostrarPopupEleganteError("Atención", "Por favor, selecciona un concepto de cuota.");
        if (selectConceptoEl) selectConceptoEl.focus();
        return;
      }

      if (!fechaPago) {
        mostrarPopupEleganteError("Atención", "Por favor, selecciona una fecha de cobro.");
        if (inputFechaEl) inputFechaEl.focus();
        return;
      }

      if (idsSeleccionados.size === 0) {
        mostrarPopupEleganteError("Sin selección", "Debes seleccionar al menos un socio para aplicar el pago masivo.");
        return;
      }

      const optionSelected = selectConceptoEl.options[selectConceptoEl.selectedIndex];
      const nombreCuota = optionSelected.dataset.nombre;
      const monto = parseFloat(optionSelected.dataset.importe);
      const periodicidad = optionSelected.dataset.periodicidad || "unico";
      const idsSocios = Array.from(idsSeleccionados);

      mostrarPopupConfirmacion(
        "Confirmar cobro masivo",
        `¿Estás seguro de registrar el pago de <strong>"${nombreCuota}"</strong> (${monto}€) a <strong>${idsSocios.length} socio(s)</strong>?`,
        async () => {
          try {
            btnEjecutarCobros.disabled = true;
            btnEjecutarCobros.textContent = "Procesando pagos...";

            const promesasPagos = idsSocios.map(async (socioId) => {
              const socioEncontrado = sociosCache.find(s => s.id === socioId);
              const socioNombre = socioEncontrado ? (socioEncontrado.nombre || socioEncontrado.nombreCompleto) : "Socio";

              const nuevoPago = {
                organizationId: currentUserOrgId,
                socioId: socioId,
                socioNombre: socioNombre,
                nombreCuota: nombreCuota,
                monto: monto,
                periodicidad: periodicidad,
                fechaPago: fechaPago,
                createdAt: new Date().toISOString()
              };

              return addDoc(collection(db, "pagos"), nuevoPago);
            });

            await Promise.all(promesasPagos);
            await cargarPagos(currentUserOrgId);

            await registrarLog(`AUTOMATIZACIONES: Ejecución de cobros masivos: ${idsSocios.length} pagos registrados para la cuota "${nombreCuota}" (${monto}€)`);

            mostrarPopupEleganteExito("¡Proceso completado!", `Se han registrado ${idsSocios.length} pagos correctamente con éxito.`, () => {
              cerrarModalPagos();
            });
            
            idsSeleccionados.clear();
            renderizarTablaSocios();

          } catch (error) {
            console.error("Error al ejecutar los pagos masivos:", error);
            mostrarPopupEleganteError("Error", "Hubo un error al registrar los pagos en lote.");
          } finally {
            btnEjecutarCobros.disabled = false;
            btnEjecutarCobros.textContent = "Procesar Pagos Masivos";
          }
        }
      );
    });
  }

  // ==========================================
  // MODAL 2: GESTIÓN Y ELIMINACIÓN DE PAGOS
  // ==========================================
  const modalEliminarPagos = document.getElementById("modalEliminarPagos");
  const btnAbrirModalEliminarPagos = document.getElementById("btnAbrirModalEliminarPagos");
  const btnCerrarModalEliminarPagos = document.getElementById("btnCerrarModalEliminarPagos");
  const btnCancelarModalEliminarPagos = document.getElementById("btnCancelarModalEliminarPagos");

  function abrirModalEliminarPagos() {
    if (modalEliminarPagos) {
      modalEliminarPagos.style.display = "flex";
      requestAnimationFrame(() => modalEliminarPagos.classList.add("activo"));
      cargarPagos(currentUserOrgId);
    }
  }

  function cerrarModalEliminarPagos() {
    if (modalEliminarPagos) {
      modalEliminarPagos.classList.remove("activo");
      setTimeout(() => { 
        modalEliminarPagos.style.display = "none"; 
        const inputBuscarPagos = document.getElementById("inputBuscarPagos");
        if (inputBuscarPagos) inputBuscarPagos.value = "";
        pagosFiltradosCache = [...pagosCache];
        paginaActualPagos = 1;
        idsPagosSeleccionados.clear();
        renderizarTablaPagos();
      }, 250);
    }
  }

  if (btnAbrirModalEliminarPagos) btnAbrirModalEliminarPagos.addEventListener("click", abrirModalEliminarPagos);
  if (btnCerrarModalEliminarPagos) btnCerrarModalEliminarPagos.addEventListener("click", cerrarModalEliminarPagos);
  if (btnCancelarModalEliminarPagos) btnCancelarModalEliminarPagos.addEventListener("click", cerrarModalEliminarPagos);

  if (modalEliminarPagos) {
    modalEliminarPagos.addEventListener("click", (e) => {
      if (e.target === modalEliminarPagos) cerrarModalEliminarPagos();
    });
  }

  const inputBuscarPagos = document.getElementById("inputBuscarPagos");
  const btnSeleccionarTodosPagos = document.getElementById("btnSeleccionarTodosPagos");
  const checkboxCabeceraPagos = document.getElementById("checkboxCabeceraPagos");
  const btnPaginaAnteriorPagos = document.getElementById("btnPaginaAnteriorPagos");
  const btnPaginaSiguientePagos = document.getElementById("btnPaginaSiguientePagos");
  const btnEjecutarEliminacionPagos = document.getElementById("btnEjecutarEliminacionPagos");

  if (inputBuscarPagos) {
    inputBuscarPagos.addEventListener("input", (e) => {
      const termino = e.target.value.toLowerCase().trim();
      pagosFiltradosCache = pagosCache.filter(pago => {
        const nombreSocio = (pago.socioNombre || "").toLowerCase();
        const concepto = (pago.nombreCuota || "").toLowerCase();
        return nombreSocio.includes(termino) || concepto.includes(termino);
      });
      paginaActualPagos = 1;
      renderizarTablaPagos();
    });
  }

  if (btnPaginaAnteriorPagos) {
    btnPaginaAnteriorPagos.addEventListener("click", () => {
      if (paginaActualPagos > 1) {
        paginaActualPagos--;
        renderizarTablaPagos();
      }
    });
  }

  if (btnPaginaSiguientePagos) {
    btnPaginaSiguientePagos.addEventListener("click", () => {
      const totalPaginas = Math.ceil(pagosFiltradosCache.length / filasPorPaginaPagos) || 1;
      if (paginaActualPagos < totalPaginas) {
        paginaActualPagos++;
        renderizarTablaPagos();
      }
    });
  }

  if (btnSeleccionarTodosPagos) {
    btnSeleccionarTodosPagos.addEventListener("click", () => {
      const inicio = (paginaActualPagos - 1) * filasPorPaginaPagos;
      const fin = inicio + filasPorPaginaPagos;
      const pagosPagina = pagosFiltradosCache.slice(inicio, fin);
      const todosMarcados = pagosPagina.every(p => idsPagosSeleccionados.has(p.id));

      pagosPagina.forEach(p => {
        if (todosMarcados) {
          idsPagosSeleccionados.delete(p.id);
        } else {
          idsPagosSeleccionados.add(p.id);
        }
      });
      renderizarTablaPagos();
    });
  }

  if (checkboxCabeceraPagos) {
    checkboxCabeceraPagos.addEventListener("change", (e) => {
      const inicio = (paginaActualPagos - 1) * filasPorPaginaPagos;
      const fin = inicio + filasPorPaginaPagos;
      const pagosPagina = pagosFiltradosCache.slice(inicio, fin);

      pagosPagina.forEach(p => {
        if (e.target.checked) {
          idsPagosSeleccionados.add(p.id);
        } else {
          idsPagosSeleccionados.delete(p.id);
        }
      });
      renderizarTablaPagos();
    });
  }

  if (btnEjecutarEliminacionPagos) {
    btnEjecutarEliminacionPagos.addEventListener("click", async () => {
      if (idsPagosSeleccionados.size === 0) {
        mostrarPopupEleganteError("Sin selección", "Por favor, selecciona al menos un pago para eliminar.");
        return;
      }

      const totalAEliminar = idsPagosSeleccionados.size;

      mostrarPopupConfirmacion(
        "Confirmar eliminación",
        `¿Estás seguro de eliminar permanentemente <strong>${totalAEliminar} registro(s) de pago</strong> seleccionado(s)?`,
        async () => {
          try {
            btnEjecutarEliminacionPagos.disabled = true;
            btnEjecutarEliminacionPagos.textContent = "Eliminando...";

            const idsArray = Array.from(idsPagosSeleccionados);
            const promesasEliminacion = idsArray.map(pagoId => deleteDoc(doc(db, "pagos", pagoId)));

            await Promise.all(promesasEliminacion);

            pagosCache = pagosCache.filter(p => !idsPagosSeleccionados.has(p.id));
            pagosFiltradosCache = pagosFiltradosCache.filter(p => !idsPagosSeleccionados.has(p.id));
            idsPagosSeleccionados.clear();

            renderizarTablaPagos();
            await registrarLog(`AUTOMATIZACIONES: Eliminación masiva de pagos: Se eliminaron ${totalAEliminar} registros de pago.`);

            mostrarPopupEleganteExito("¡Eliminación exitosa!", `Se han eliminado ${totalAEliminar} pago(s) correctamente.`);

          } catch (error) {
            console.error("Error al eliminar los pagos:", error);
            mostrarPopupEleganteError("Error", "Hubo un problema al intentar eliminar los pagos seleccionados.");
          } finally {
            btnEjecutarEliminacionPagos.disabled = false;
            btnEjecutarEliminacionPagos.textContent = "Eliminar Seleccionados";
          }
        }
      );
    });
  }

  // ==========================================
  // MODAL 3: ELIMINACIÓN MASIVA DE USUARIOS
  // ==========================================
  const modalEliminarUsuarios = document.getElementById("modalEliminarUsuarios");
  const btnAbrirModalEliminarUsuarios = document.getElementById("btnAbrirModalEliminarUsuarios");
  const btnCerrarModalEliminarUsuarios = document.getElementById("btnCerrarModalEliminarUsuarios");
  const btnCancelarModalEliminarUsuarios = document.getElementById("btnCancelarModalEliminarUsuarios");

  function abrirModalEliminarUsuarios() {
    if (modalEliminarUsuarios) {
      modalEliminarUsuarios.style.display = "flex";
      requestAnimationFrame(() => modalEliminarUsuarios.classList.add("activo"));
      cargarSocios(currentUserOrgId);
    }
  }

  function cerrarModalEliminarUsuarios() {
    if (modalEliminarUsuarios) {
      modalEliminarUsuarios.classList.remove("activo");
      setTimeout(() => { 
        modalEliminarUsuarios.style.display = "none"; 
        const inputBuscarDniUsuarios = document.getElementById("inputBuscarDniUsuarios");
        if (inputBuscarDniUsuarios) inputBuscarDniUsuarios.value = "";
        usuariosFiltradosCache = [...sociosCache];
        paginaActualUsuarios = 1;
        idsUsuariosSeleccionados.clear();
        renderizarTablaUsuariosEliminar();
      }, 250);
    }
  }

  if (btnAbrirModalEliminarUsuarios) btnAbrirModalEliminarUsuarios.addEventListener("click", abrirModalEliminarUsuarios);
  if (btnCerrarModalEliminarUsuarios) btnCerrarModalEliminarUsuarios.addEventListener("click", cerrarModalEliminarUsuarios);
  if (btnCancelarModalEliminarUsuarios) btnCancelarModalEliminarUsuarios.addEventListener("click", cerrarModalEliminarUsuarios);

  if (modalEliminarUsuarios) {
    modalEliminarUsuarios.addEventListener("click", (e) => {
      if (e.target === modalEliminarUsuarios) cerrarModalEliminarUsuarios();
    });
  }

  const inputBuscarDniUsuarios = document.getElementById("inputBuscarDniUsuarios");
  const btnSeleccionarTodosUsuarios = document.getElementById("btnSeleccionarTodosUsuarios");
  const checkboxCabeceraUsuarios = document.getElementById("checkboxCabeceraUsuarios");
  const btnPaginaAnteriorUsuarios = document.getElementById("btnPaginaAnteriorUsuarios");
  const btnPaginaSiguienteUsuarios = document.getElementById("btnPaginaSiguienteUsuarios");
  const btnEjecutarEliminacionUsuarios = document.getElementById("btnEjecutarEliminacionUsuarios");

  if (inputBuscarDniUsuarios) {
    inputBuscarDniUsuarios.addEventListener("input", (e) => {
      const termino = e.target.value.toLowerCase().trim();
      usuariosFiltradosCache = sociosCache.filter(socio => {
        const dniSocio = (socio.dni || socio.nif || "").toLowerCase();
        const nombreSocio = (socio.nombre || socio.nombreCompleto || "").toLowerCase();
        return dniSocio.includes(termino) || nombreSocio.includes(termino);
      });
      paginaActualUsuarios = 1;
      renderizarTablaUsuariosEliminar();
    });
  }

  if (btnPaginaAnteriorUsuarios) {
    btnPaginaAnteriorUsuarios.addEventListener("click", () => {
      if (paginaActualUsuarios > 1) {
        paginaActualUsuarios--;
        renderizarTablaUsuariosEliminar();
      }
    });
  }

  if (btnPaginaSiguienteUsuarios) {
    btnPaginaSiguienteUsuarios.addEventListener("click", () => {
      const totalPaginas = Math.ceil(usuariosFiltradosCache.length / filasPorPaginaUsuarios) || 1;
      if (paginaActualUsuarios < totalPaginas) {
        paginaActualUsuarios++;
        renderizarTablaUsuariosEliminar();
      }
    });
  }

  if (btnSeleccionarTodosUsuarios) {
    btnSeleccionarTodosUsuarios.addEventListener("click", () => {
      const inicio = (paginaActualUsuarios - 1) * filasPorPaginaUsuarios;
      const fin = inicio + filasPorPaginaUsuarios;
      const usuariosPagina = usuariosFiltradosCache.slice(inicio, fin);
      const todosMarcados = usuariosPagina.every(u => idsUsuariosSeleccionados.has(u.id));

      usuariosPagina.forEach(u => {
        if (todosMarcados) {
          idsUsuariosSeleccionados.delete(u.id);
        } else {
          idsUsuariosSeleccionados.add(u.id);
        }
      });
      renderizarTablaUsuariosEliminar();
    });
  }

  if (checkboxCabeceraUsuarios) {
    checkboxCabeceraUsuarios.addEventListener("change", (e) => {
      const inicio = (paginaActualUsuarios - 1) * filasPorPaginaUsuarios;
      const fin = inicio + filasPorPaginaUsuarios;
      const usuariosPagina = usuariosFiltradosCache.slice(inicio, fin);

      usuariosPagina.forEach(u => {
        if (e.target.checked) {
          idsUsuariosSeleccionados.add(u.id);
        } else {
          idsUsuariosSeleccionados.delete(u.id);
        }
      });
      renderizarTablaUsuariosEliminar();
    });
  }

  if (btnEjecutarEliminacionUsuarios) {
    btnEjecutarEliminacionUsuarios.addEventListener("click", async () => {
      if (idsUsuariosSeleccionados.size === 0) {
        mostrarPopupEleganteError("Sin selección", "Por favor, selecciona al menos un usuario para eliminar.");
        return;
      }

      const totalAEliminar = idsUsuariosSeleccionados.size;

      mostrarPopupConfirmacion(
        "Confirmar eliminación masiva",
        `⚠️ ¿Estás seguro de eliminar permanentemente a <strong>${totalAEliminar} socio(s)</strong> junto con <strong>todos sus pagos asociados</strong>? Esta acción no se puede deshacer.`,
        async () => {
          try {
            btnEjecutarEliminacionUsuarios.disabled = true;
            btnEjecutarEliminacionUsuarios.textContent = "Eliminando usuarios y pagos...";

            const idsArray = Array.from(idsUsuariosSeleccionados);
            const promesasSocios = idsArray.map(socioId => deleteDoc(doc(db, "socios", socioId)));

            const qPagos = query(collection(db, "pagos"), where("organizationId", "==", currentUserOrgId));
            const querySnapshotPagos = await getDocs(qPagos);
            
            let contadorPagosAsociadosEliminados = 0;
            const promesasPagosAsociados = [];
            querySnapshotPagos.forEach((docPagoSnap) => {
              const pagoData = docPagoSnap.data();
              if (idsArray.includes(pagoData.socioId)) {
                promesasPagosAsociados.push(deleteDoc(doc(db, "pagos", docPagoSnap.id)));
                contadorPagosAsociadosEliminados++;
              }
            });

            await Promise.all([...promesasSocios, ...promesasPagosAsociados]);

            sociosCache = sociosCache.filter(s => !idsUsuariosSeleccionados.has(s.id));
            usuariosFiltradosCache = usuariosFiltradosCache.filter(s => !idsUsuariosSeleccionados.has(s.id));
            
            await cargarPagos(currentUserOrgId);

            idsUsuariosSeleccionados.clear();
            renderizarTablaUsuariosEliminar();
            renderizarTablaSocios();

            await registrarLog(`AUTOMATIZACIONES: Eliminación masiva de socios: Se eliminaron ${totalAEliminar} socios y ${contadorPagosAsociadosEliminados} pagos asociados.`);

            mostrarPopupEleganteExito("¡Eliminación completada!", `Se han dado de baja ${totalAEliminar} socio(s) y se eliminaron sus pagos asociados correctamente.`, () => {
              cerrarModalEliminarUsuarios();
            });

          } catch (error) {
            console.error("Error al ejecutar la eliminación masiva de usuarios:", error);
            mostrarPopupEleganteError("Error", "Hubo un problema al intentar eliminar los usuarios seleccionados.");
          } finally {
            btnEjecutarEliminacionUsuarios.disabled = false;
            btnEjecutarEliminacionUsuarios.textContent = "Eliminar Usuarios";
          }
        }
      );
    });
  }

  // ==========================================
  // MODAL 4: INFORMACIÓN DE USUARIOS
  // ==========================================
  const modalInfoUsuarios = document.getElementById("modalInfoUsuarios");
  const btnAbrirModalInfoUsuarios = document.getElementById("btnAbrirModalInfoUsuarios");
  const btnCerrarModalInfoUsuarios = document.getElementById("btnCerrarModalInfoUsuarios");
  const btnCerrarPieModalInfo = document.getElementById("btnCerrarPieModalInfo");
  const selectFiltroInfoUsuarios = document.getElementById("selectFiltroInfoUsuarios");
  const btnPaginaAnteriorInfo = document.getElementById("btnPaginaAnteriorInfo");
  const btnPaginaSiguienteInfo = document.getElementById("btnPaginaSiguienteInfo");

  const btnExportarCsvUsuarios = document.getElementById("btnExportarCsvUsuarios");

  if (btnExportarCsvUsuarios) {
    btnExportarCsvUsuarios.addEventListener("click", () => {
      if (!infoUsuariosCache || infoUsuariosCache.length === 0) {
        mostrarPopupEleganteError("Sin datos", "No hay registros disponibles para exportar con el filtro actual.");
        return;
      }

      const selectFiltro = document.getElementById("selectFiltroInfoUsuarios");
      const tipoFiltro = selectFiltro ? selectFiltro.value : "todos";

      let cabeceras = [];
      let filas = [];

      if (tipoFiltro === "federados") {
        cabeceras = ["Nombre y Apellidos", "F. Nacimiento", "Sexo", "DNI", "Licencia Federativa"];
        filas = infoUsuariosCache.map(item => {
          const nombrePuro = item.nombre || "";
          const apellidosPuros = item.apellidos || "";
          const nombreCompleto = item.nombreCompleto || (nombrePuro + (apellidosPuros ? " " + apellidosPuros : "")) || "Sin nombre";
          
          const nombreFormat = `"${nombreCompleto.replace(/"/g, '""')}"`;
          const fNac = item.fechaNacimiento || item.nacimiento || "-";
          const sexo = `"${(item.sexo || item.genero || "-").replace(/"/g, '""')}"`;
          const dni = `"${(item.dni || item.nif || "-").replace(/"/g, '""')}"`;
          const licencia = `"${(item.licenciaFederativa || item.licencia || "-").replace(/"/g, '""')}"`;
          return [nombreFormat, fNac, sexo, dni, licencia].join(";");
        });
      } else {
        cabeceras = ["Nombre del Socio", "DNI / NIF", "Genero", "Fecha de Nacimiento", "Edad", "Fecha de Alta"];
        filas = infoUsuariosCache.map(socio => {
          const nombre = `"${(socio.nombre || socio.nombreCompleto || "Sin nombre").replace(/"/g, '""')}"`;
          const dni = `"${(socio.dni || socio.nif || "Sin DNI").replace(/"/g, '""')}"`;
          const genero = `"${(socio.genero || socio.sexo || "-").replace(/"/g, '""')}"`;
          const fechaNac = socio.fechaNacimiento || socio.nacimiento || "-";
          const edad = calcularEdad(fechaNac) !== null ? calcularEdad(fechaNac) : "-";
          const fechaAlta = socio.fechaAlta || socio.createdAt ? new Date(socio.fechaAlta || socio.createdAt).toLocaleDateString() : "-";
          return [nombre, dni, genero, fechaNac, edad, fechaAlta].join(";");
        });
      }

      const contenidoCsv = [cabeceras.join(";"), ...filas].join("\n");
      const blob = new Blob(["\ufeff" + contenidoCsv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `listado_${tipoFiltro}_${new Date().toISOString().split("T")[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      registrarLog(`AUTOMATIZACIONES: Exportación de CSV de usuarios/federados (${infoUsuariosCache.length} registros).`);
    });
  }

  function abrirModalInfoUsuarios() {
    if (modalInfoUsuarios) {
      modalInfoUsuarios.style.display = "flex";
      requestAnimationFrame(() => modalInfoUsuarios.classList.add("activo"));
      cargarFederados(currentUserOrgId).then(() => {
        aplicarFiltroInformacionUsuarios();
      });
    }
  }

  function cerrarModalInfoUsuarios() {
    if (modalInfoUsuarios) {
      modalInfoUsuarios.classList.remove("activo");
      setTimeout(() => { 
        modalInfoUsuarios.style.display = "none"; 
      }, 250);
    }
  }

  if (btnAbrirModalInfoUsuarios) btnAbrirModalInfoUsuarios.addEventListener("click", abrirModalInfoUsuarios);
  if (btnCerrarModalInfoUsuarios) btnCerrarModalInfoUsuarios.addEventListener("click", cerrarModalInfoUsuarios);
  if (btnCerrarPieModalInfo) btnCerrarPieModalInfo.addEventListener("click", cerrarModalInfoUsuarios);

  if (modalInfoUsuarios) {
    modalInfoUsuarios.addEventListener("click", (e) => {
      if (e.target === modalInfoUsuarios) cerrarModalInfoUsuarios();
    });
  }

  if (selectFiltroInfoUsuarios) {
    selectFiltroInfoUsuarios.addEventListener("change", () => {
      paginaActualInfo = 1;
      aplicarFiltroInformacionUsuarios();
    });
  }

  if (btnPaginaAnteriorInfo) {
    btnPaginaAnteriorInfo.addEventListener("click", () => {
      if (paginaActualInfo > 1) {
        paginaActualInfo--;
        renderizarTablaInfoUsuarios();
      }
    });
  }

  if (btnPaginaSiguienteInfo) {
    btnPaginaSiguienteInfo.addEventListener("click", () => {
      const totalPaginas = Math.ceil(infoUsuariosCache.length / filasPorPaginaInfo) || 1;
      if (paginaActualInfo < totalPaginas) {
        paginaActualInfo++;
        renderizarTablaInfoUsuarios();
      }
    });
  }
});

// ==========================================
// FUNCIONES DE CARGA Y RENDERIZADO
// ==========================================

async function cargarConceptos(orgId) {
  const selectConcepto = document.getElementById("autoSelectConcepto");
  if (!selectConcepto) return;

  try {
    selectConcepto.innerHTML = `<option value="">Selecciona un concepto...</option>`;
    const q = query(collection(db, "cuotas_config"), where("organizationId", "==", orgId));
    const querySnapshot = await getDocs(q);
    
    let conceptosTemp = [];
    querySnapshot.forEach((docSnap) => {
      conceptosTemp.push({ id: docSnap.id, ...docSnap.data() });
    });

    conceptosTemp.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));

    conceptosTemp.forEach(data => {
      const option = document.createElement("option");
      option.value = data.id;
      option.textContent = `${data.nombre || 'Cuota'} (${data.importe || 0}€)`;
      option.dataset.importe = data.importe || 0;
      option.dataset.nombre = data.nombre || 'Cuota';
      option.dataset.periodicidad = data.periodicidad || 'unico';
      selectConcepto.appendChild(option);
    });
  } catch (error) {
    console.error("Error al cargar conceptos:", error);
    selectConcepto.innerHTML = `<option value="">Error al cargar conceptos</option>`;
  }
}

async function cargarSocios(orgId) {
  const tablaBody = document.getElementById("tablaSociosAutomatizacionBody");
  const tablaBodyUsuarios = document.getElementById("tablaUsuariosEliminarBody");
  if (!tablaBody && !tablaBodyUsuarios) return;

  try {
    if (tablaBody) tablaBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 2rem;">Cargando socios...</td></tr>`;
    if (tablaBodyUsuarios) tablaBodyUsuarios.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 2rem;">Cargando socios...</td></tr>`;
    
    const q = query(collection(db, "socios"), where("organizationId", "==", orgId));
    const querySnapshot = await getDocs(q);
    
    sociosCache = [];
    querySnapshot.forEach((docSnap) => {
      sociosCache.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    sociosCache.sort((a, b) => {
      const nombreA = (a.nombre || a.nombreCompleto || "").toLowerCase();
      const nombreB = (b.nombre || b.nombreCompleto || "").toLowerCase();
      return nombreA.localeCompare(nombreB);
    });

    sociosFiltradosCache = [...sociosCache];
    usuariosFiltradosCache = [...sociosCache];
    paginaActual = 1;
    paginaActualUsuarios = 1;

    renderizarTablaSocios();
    renderizarTablaUsuariosEliminar();
  } catch (error) {
    console.error("Error al cargar socios:", error);
  }
}

async function cargarFederados(orgId) {
  try {
    const q = query(collection(db, "federacion"), where("organizationId", "==", orgId));
    const querySnapshot = await getDocs(q);
    
    federadosCache = [];
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      // Unimos nombre y apellidos de forma limpia
      const nombrePuro = data.nombre || "";
      const apellidosPuros = data.apellidos || "";
      const nombreCompletoUnido = `${nombrePuro} ${apellidosPuros}`.trim();

      federadosCache.push({
        id: docSnap.id,
        ...data,
        nombreCompleto: nombreCompletoUnido || "Sin nombre"
      });
    });

    // Ordenamiento alfabético por el nombre completo unificado
    federadosCache.sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto));
  } catch (error) {
    console.error("Error al cargar federados:", error);
    federadosCache = [];
  }
}

async function cargarPagos(orgId) {
  const tablaBody = document.getElementById("tablaPagosEliminarBody");
  if (!tablaBody) return;

  try {
    tablaBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 2rem;">Cargando pagos...</td></tr>`;
    const q = query(collection(db, "pagos"), where("organizationId", "==", orgId));
    const querySnapshot = await getDocs(q);
    
    pagosCache = [];
    querySnapshot.forEach((docSnap) => {
      pagosCache.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    pagosCache.sort((a, b) => new Date(b.fechaPago || 0) - new Date(a.fechaPago || 0));
    pagosFiltradosCache = [...pagosCache];
    paginaActualPagos = 1;
    renderizarTablaPagos();
  } catch (error) {
    console.error("Error al cargar pagos:", error);
  }
}

function renderizarTablaSocios() {
  const tablaBody = document.getElementById("tablaSociosAutomatizacionBody");
  const contadorSeleccionados = document.getElementById("contadorSeleccionados");
  const textoPaginacionInfo = document.getElementById("textoPaginacionInfo");
  const textoPaginaActual = document.getElementById("textoPaginaActual");
  const btnPaginaAnterior = document.getElementById("btnPaginaAnterior");
  const btnPaginaSiguiente = document.getElementById("btnPaginaSiguiente");
  const checkboxCabecera = document.getElementById("checkboxCabecera");

  if (!tablaBody) return;

  if (sociosFiltradosCache.length === 0) {
    tablaBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 2rem;">No se encontraron socios.</td></tr>`;
    if (textoPaginacionInfo) textoPaginacionInfo.textContent = `Mostrando 0-0 de 0`;
    if (textoPaginaActual) textoPaginaActual.textContent = `1 / 1`;
    if (btnPaginaAnterior) btnPaginaAnterior.disabled = true;
    if (btnPaginaSiguiente) btnPaginaSiguiente.disabled = true;
    if (contadorSeleccionados) contadorSeleccionados.textContent = `${idsSeleccionados.size} socio(s) seleccionado(s)`;
    return;
  }

  const totalPaginas = Math.ceil(sociosFiltradosCache.length / filasPorPagina);
  if (paginaActual > totalPaginas) paginaActual = totalPaginas;

  const inicio = (paginaActual - 1) * filasPorPagina;
  const fin = Math.min(inicio + filasPorPagina, sociosFiltradosCache.length);
  const sociosPagina = sociosFiltradosCache.slice(inicio, fin);

  tablaBody.innerHTML = "";
  sociosPagina.forEach((socio) => {
    const isChecked = idsSeleccionados.has(socio.id);
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid var(--border-color, #f1f5f9)";
    tr.innerHTML = `
      <td style="padding: 0.6rem 0.5rem; text-align: center;">
        <input type="checkbox" class="socio-checkbox" value="${socio.id}" ${isChecked ? 'checked' : ''} style="cursor: pointer;">
      </td>
      <td style="padding: 0.6rem; font-weight: 500; color: var(--text-main, #1e293b);">${socio.nombre || socio.nombreCompleto || 'Sin nombre'}</td>
      <td style="padding: 0.6rem; color: var(--text-secondary, #64748b); font-family: monospace;">${socio.dni || socio.nif || 'Sin DNI'}</td>
      <td style="padding: 0.6rem; text-align: right; font-weight: 600;">-</td>
    `;
    tablaBody.appendChild(tr);
  });

  if (textoPaginacionInfo) textoPaginacionInfo.textContent = `Mostrando ${inicio + 1}-${fin} de ${sociosFiltradosCache.length}`;
  if (textoPaginaActual) textoPaginaActual.textContent = `${paginaActual} / ${totalPaginas}`;
  if (btnPaginaAnterior) btnPaginaAnterior.disabled = paginaActual <= 1;
  if (btnPaginaSiguiente) btnPaginaSiguiente.disabled = paginaActual >= totalPaginas;

  if (checkboxCabecera) {
    const todosEnPaginaSeleccionados = sociosPagina.length > 0 && sociosPagina.every(s => idsSeleccionados.has(s.id));
    checkboxCabecera.checked = todosEnPaginaSeleccionados;
  }

  if (contadorSeleccionados) {
    contadorSeleccionados.textContent = `${idsSeleccionados.size} socio(s) seleccionado(s)`;
  }

  vincularEventosCheckboxesSocios();
}

function vincularEventosCheckboxesSocios() {
  const checkboxes = document.querySelectorAll(".socio-checkbox");
  checkboxes.forEach((chk) => {
    chk.addEventListener("change", (e) => {
      const socioId = e.target.value;
      if (e.target.checked) {
        idsSeleccionados.add(socioId);
      } else {
        idsSeleccionados.delete(socioId);
      }
      
      const contadorSeleccionados = document.getElementById("contadorSeleccionados");
      if (contadorSeleccionados) {
        contadorSeleccionados.textContent = `${idsSeleccionados.size} socio(s) seleccionado(s)`;
      }
    });
  });
}

function renderizarTablaPagos() {
  const tablaBody = document.getElementById("tablaPagosEliminarBody");
  const contadorPagosSeleccionados = document.getElementById("contadorPagosSeleccionados");
  const textoPaginacionPagosInfo = document.getElementById("textoPaginacionPagosInfo");
  const textoPaginaActualPagos = document.getElementById("textoPaginaActualPagos");
  const btnPaginaAnteriorPagos = document.getElementById("btnPaginaAnteriorPagos");
  const btnPaginaSiguientePagos = document.getElementById("btnPaginaSiguientePagos");
  const checkboxCabeceraPagos = document.getElementById("checkboxCabeceraPagos");

  if (!tablaBody) return;

  if (pagosFiltradosCache.length === 0) {
    tablaBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 2rem;">No se encontraron registros de pagos.</td></tr>`;
    if (textoPaginacionPagosInfo) textoPaginacionPagosInfo.textContent = `Mostrando 0-0 de 0`;
    if (textoPaginaActualPagos) textoPaginaActualPagos.textContent = `1 / 1`;
    if (btnPaginaAnteriorPagos) btnPaginaAnteriorPagos.disabled = true;
    if (btnPaginaSiguientePagos) btnPaginaSiguientePagos.disabled = true;
    if (contadorPagosSeleccionados) contadorPagosSeleccionados.textContent = `${idsPagosSeleccionados.size} pagos seleccionados`;
    return;
  }

  const totalPaginas = Math.ceil(pagosFiltradosCache.length / filasPorPaginaPagos);
  if (paginaActualPagos > totalPaginas) paginaActualPagos = totalPaginas;

  const inicio = (paginaActualPagos - 1) * filasPorPaginaPagos;
  const fin = Math.min(inicio + filasPorPaginaPagos, pagosFiltradosCache.length);
  const pagosPagina = pagosFiltradosCache.slice(inicio, fin);

  tablaBody.innerHTML = "";
  pagosPagina.forEach((pago) => {
    const isChecked = idsPagosSeleccionados.has(pago.id);
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid var(--border-color, #f1f5f9)";
    tr.innerHTML = `
      <td style="padding: 0.6rem 0.5rem; text-align: center;">
        <input type="checkbox" class="pago-checkbox" value="${pago.id}" ${isChecked ? 'checked' : ''} style="cursor: pointer;">
      </td>
      <td style="padding: 0.6rem; font-weight: 500; color: var(--text-main, #1e293b);">${pago.socioNombre || 'Socio desconocido'}</td>
      <td style="padding: 0.6rem; color: var(--text-secondary, #475569);">${pago.nombreCuota || 'Cuota general'}</td>
      <td style="padding: 0.6rem; color: var(--text-secondary, #64748b);">${pago.fechaPago || '-'}</td>
      <td style="padding: 0.6rem; text-align: right; font-weight: 600; color: #16a34a;">${pago.monto ? pago.monto.toFixed(2) + '€' : '0.00€'}</td>
      <td style="padding: 0.6rem; text-align: center;">
        <button type="button" class="btn-eliminar-individual" data-id="${pago.id}" title="Eliminar pago" style="background: none; border: none; cursor: pointer; color: #ef4444; padding: 0.25rem;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </td>
    `;
    tablaBody.appendChild(tr);
  });

  if (textoPaginacionPagosInfo) textoPaginacionPagosInfo.textContent = `Mostrando ${inicio + 1}-${fin} de ${pagosFiltradosCache.length}`;
  if (textoPaginaActualPagos) textoPaginaActualPagos.textContent = `${paginaActualPagos} / ${totalPaginas}`;
  if (btnPaginaAnteriorPagos) btnPaginaAnteriorPagos.disabled = paginaActualPagos <= 1;
  if (btnPaginaSiguientePagos) btnPaginaSiguientePagos.disabled = paginaActualPagos >= totalPaginas;

  if (checkboxCabeceraPagos) {
    const todosEnPaginaSeleccionados = pagosPagina.length > 0 && pagosPagina.every(p => idsPagosSeleccionados.has(p.id));
    checkboxCabeceraPagos.checked = todosEnPaginaSeleccionados;
  }

  if (contadorPagosSeleccionados) {
    contadorPagosSeleccionados.textContent = `${idsPagosSeleccionados.size} pagos seleccionados`;
  }

  vincularEventosCheckboxesPagos();
}

function vincularEventosCheckboxesPagos() {
  const checkboxes = document.querySelectorAll(".pago-checkbox");
  checkboxes.forEach((chk) => {
    chk.addEventListener("change", (e) => {
      const pagoId = e.target.value;
      if (e.target.checked) {
        idsPagosSeleccionados.add(pagoId);
      } else {
        idsPagosSeleccionados.delete(pagoId);
      }
      
      const contadorPagosSeleccionados = document.getElementById("contadorPagosSeleccionados");
      if (contadorPagosSeleccionados) {
        contadorPagosSeleccionados.textContent = `${idsPagosSeleccionados.size} pagos seleccionados`;
      }
    });
  });

  const botonesEliminarIndividual = document.querySelectorAll(".btn-eliminar-individual");
  botonesEliminarIndividual.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const pagoId = e.currentTarget.dataset.id;
      mostrarPopupConfirmacion(
        "Eliminar pago",
        "¿Estás seguro de eliminar este registro de pago de forma individual?",
        async () => {
          try {
            await deleteDoc(doc(db, "pagos", pagoId));
            pagosCache = pagosCache.filter(p => p.id !== pagoId);
            pagosFiltradosCache = pagosFiltradosCache.filter(p => p.id !== pagoId);
            idsPagosSeleccionados.delete(pagoId);
            renderizarTablaPagos();
            await registrarLog(`AUTOMATIZACIONES: Eliminación individual de pago (ID: ${pagoId})`);
            mostrarPopupEleganteExito("Eliminado", "El pago se ha eliminado correctamente.");
          } catch (error) {
            console.error("Error al eliminar pago individual:", error);
            mostrarPopupEleganteError("Error", "No se pudo eliminar el pago.");
          }
        }
      );
    });
  });
}

function renderizarTablaUsuariosEliminar() {
  const tablaBody = document.getElementById("tablaUsuariosEliminarBody");
  const contadorUsuariosSeleccionados = document.getElementById("contadorUsuariosSeleccionados");
  const textoPaginacionUsuariosInfo = document.getElementById("textoPaginacionUsuariosInfo");
  const textoPaginaActualUsuarios = document.getElementById("textoPaginaActualUsuarios");
  const btnPaginaAnteriorUsuarios = document.getElementById("btnPaginaAnteriorUsuarios");
  const btnPaginaSiguienteUsuarios = document.getElementById("btnPaginaSiguienteUsuarios");
  const checkboxCabeceraUsuarios = document.getElementById("checkboxCabeceraUsuarios");

  if (!tablaBody) return;

  if (usuariosFiltradosCache.length === 0) {
    tablaBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 2rem;">No se encontraron socios.</td></tr>`;
    if (textoPaginacionUsuariosInfo) textoPaginacionUsuariosInfo.textContent = `Mostrando 0-0 de 0`;
    if (textoPaginaActualUsuarios) textoPaginaActualUsuarios.textContent = `1 / 1`;
    if (btnPaginaAnteriorUsuarios) btnPaginaAnteriorUsuarios.disabled = true;
    if (btnPaginaSiguienteUsuarios) btnPaginaSiguienteUsuarios.disabled = true;
    if (contadorUsuariosSeleccionados) contadorUsuariosSeleccionados.textContent = `${idsUsuariosSeleccionados.size} usuarios seleccionados`;
    return;
  }

  const totalPaginas = Math.ceil(usuariosFiltradosCache.length / filasPorPaginaUsuarios);
  if (paginaActualUsuarios > totalPaginas) paginaActualUsuarios = totalPaginas;

  const inicio = (paginaActualUsuarios - 1) * filasPorPaginaUsuarios;
  const fin = Math.min(inicio + filasPorPaginaUsuarios, usuariosFiltradosCache.length);
  const usuariosPagina = usuariosFiltradosCache.slice(inicio, fin);

  tablaBody.innerHTML = "";
  usuariosPagina.forEach((socio) => {
    const isChecked = idsUsuariosSeleccionados.has(socio.id);
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid var(--border-color, #f1f5f9)";
    tr.innerHTML = `
      <td style="padding: 0.6rem 0.5rem; text-align: center;">
        <input type="checkbox" class="usuario-eliminar-checkbox" value="${socio.id}" ${isChecked ? 'checked' : ''} style="cursor: pointer;">
      </td>
      <td style="padding: 0.6rem; font-weight: 500; color: var(--text-main, #1e293b);">${socio.nombre || socio.nombreCompleto || 'Sin nombre'}</td>
      <td style="padding: 0.6rem; color: var(--text-secondary, #64748b); font-family: monospace;">${socio.dni || socio.nif || 'Sin DNI'}</td>
      <td style="padding: 0.6rem; text-align: right; color: var(--text-secondary, #64748b); font-weight: 500;">Activo</td>
    `;
    tablaBody.appendChild(tr);
  });

  if (textoPaginacionUsuariosInfo) textoPaginacionUsuariosInfo.textContent = `Mostrando ${inicio + 1}-${fin} de ${usuariosFiltradosCache.length}`;
  if (textoPaginaActualUsuarios) textoPaginaActualUsuarios.textContent = `${paginaActualUsuarios} / ${totalPaginas}`;
  if (btnPaginaAnteriorUsuarios) btnPaginaAnteriorUsuarios.disabled = paginaActualUsuarios <= 1;
  if (btnPaginaSiguienteUsuarios) btnPaginaSiguienteUsuarios.disabled = paginaActualUsuarios >= totalPaginas;

  if (checkboxCabeceraUsuarios) {
    const todosEnPaginaSeleccionados = usuariosPagina.length > 0 && usuariosPagina.every(u => idsUsuariosSeleccionados.has(u.id));
    checkboxCabeceraUsuarios.checked = todosEnPaginaSeleccionados;
  }

  if (contadorUsuariosSeleccionados) {
    contadorUsuariosSeleccionados.textContent = `${idsUsuariosSeleccionados.size} usuarios seleccionados`;
  }

  vincularEventosCheckboxesUsuarios();
}

function vincularEventosCheckboxesUsuarios() {
  const checkboxes = document.querySelectorAll(".usuario-eliminar-checkbox");
  checkboxes.forEach((chk) => {
    chk.addEventListener("change", (e) => {
      const socioId = e.target.value;
      if (e.target.checked) {
        idsUsuariosSeleccionados.add(socioId);
      } else {
        idsUsuariosSeleccionados.delete(socioId);
      }
      
      const contadorUsuariosSeleccionados = document.getElementById("contadorUsuariosSeleccionados");
      if (contadorUsuariosSeleccionados) {
        contadorUsuariosSeleccionados.textContent = `${idsUsuariosSeleccionados.size} usuarios seleccionados`;
      }
    });
  });
}

// ==========================================
// FUNCIONES PARA INFORMACIÓN DE USUARIOS
// ==========================================

function calcularEdad(fechaNacimientoStr) {
  if (!fechaNacimientoStr) return null;
  const hoy = new Date();
  const nacimiento = new Date(fechaNacimientoStr);
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const m = hoy.getMonth() - nacimiento.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nacimiento.getDate())) {
    edad--;
  }
  return edad;
}

function aplicarFiltroInformacionUsuarios() {
  const selectFiltro = document.getElementById("selectFiltroInfoUsuarios");
  const tipoFiltro = selectFiltro ? selectFiltro.value : "todos";
  const anioActual = new Date().getFullYear();

  if (tipoFiltro === "federados") {
    // Si selecciona federados, utilizamos la caché de la colección "federacion"
    infoUsuariosCache = [...federadosCache];
  } else {
    infoUsuariosCache = sociosCache.filter(socio => {
      const genero = (socio.genero || socio.sexo || "").toLowerCase();
      const fechaAltaStr = socio.fechaAlta || socio.createdAt || socio.creado || "";
      const anioAlta = fechaAltaStr ? new Date(fechaAltaStr).getFullYear() : null;
      const fechaNac = socio.fechaNacimiento || socio.nacimiento || "";
      const edad = calcularEdad(fechaNac);

      if (tipoFiltro === "hombres") {
        return genero === "hombre" || genero === "masculino" || genero === "h";
      }
      if (tipoFiltro === "mujeres") {
        return genero === "mujer" || genero === "femenino" || genero === "m";
      }
      if (tipoFiltro === "menores") {
        return edad !== null && edad < 18;
      }
      if (tipoFiltro === "altas_anio") {
        return anioAlta === anioActual;
      }
      
      return true;
    });
  }

  paginaActualInfo = 1;
  renderizarTablaInfoUsuarios();
}

function renderizarTablaInfoUsuarios() {
  const tablaHead = document.getElementById("tablaInfoUsuariosHead");
  const tablaBody = document.getElementById("tablaInfoUsuariosBody");
  const badgeContador = document.getElementById("badgeContadorTotalInfo");
  const textoPaginacionInfo = document.getElementById("textoPaginacionInfoUsuarios");
  const textoPaginaActual = document.getElementById("textoPaginaActualInfo");
  const btnAnterior = document.getElementById("btnPaginaAnteriorInfo");
  const btnSiguiente = document.getElementById("btnPaginaSiguienteInfo");

  const selectFiltro = document.getElementById("selectFiltroInfoUsuarios");
  const tipoFiltro = selectFiltro ? selectFiltro.value : "todos";

  if (!tablaBody) return;

  if (badgeContador) {
    badgeContador.textContent = `${infoUsuariosCache.length} registro(s)`;
  }

  // Dinámica de columnas según el filtro seleccionado
  if (tipoFiltro === "federados") {
    if (tablaHead) {
      tablaHead.innerHTML = `
        <tr>
          <th>Nombre y Apellidos</th>
          <th>F. Nacimiento</th>
          <th>Sexo</th>
          <th>DNI</th>
          <th style="text-align: right;">Licencia Federativa</th>
        </tr>
      `;
    }
  } else {
    if (tablaHead) {
      tablaHead.innerHTML = `
        <tr>
          <th>Nombre del Socio</th>
          <th>DNI / NIF</th>
          <th>Género</th>
          <th>Fecha Nac. / Edad</th>
          <th style="text-align: right;">Fecha de Alta</th>
        </tr>
      `;
    }
  }

  if (infoUsuariosCache.length === 0) {
    const colSpan = tipoFiltro === "federados" ? 5 : 5;
    tablaBody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; color: var(--text-muted); padding: 2rem;">No se encontraron registros con este criterio.</td></tr>`;
    if (textoPaginacionInfo) textoPaginacionInfo.textContent = `Mostrando 0-0 de 0`;
    if (textoPaginaActual) textoPaginaActual.textContent = `1 / 1`;
    if (btnAnterior) btnAnterior.disabled = true;
    if (btnSiguiente) btnSiguiente.disabled = true;
    return;
  }

  const totalPaginas = Math.ceil(infoUsuariosCache.length / filasPorPaginaInfo);
  if (paginaActualInfo > totalPaginas) paginaActualInfo = totalPaginas;

  const inicio = (paginaActualInfo - 1) * filasPorPaginaInfo;
  const fin = Math.min(inicio + filasPorPaginaInfo, infoUsuariosCache.length);
  const paginaElementos = infoUsuariosCache.slice(inicio, fin);

  tablaBody.innerHTML = "";
  
  paginaElementos.forEach(item => {
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid var(--border-color, #f1f5f9)";

    if (tipoFiltro === "federados") {
      const nombrePuro = item.nombre || "";
      const apellidosPuros = item.apellidos || "";
      const nombreCompleto = item.nombreCompleto || (nombrePuro + (apellidosPuros ? " " + apellidosPuros : "")) || "Sin nombre";
      
      const fechaNac = item.fechaNacimiento || item.nacimiento || "-";
      const sexo = item.sexo || item.genero || "-";
      const dni = item.dni || item.nif || "-";
      const licencia = item.licenciaFederativa || item.licencia || "-";

      tr.innerHTML = `
        <td style="padding: 0.6rem; font-weight: 500; color: var(--text-main);">${nombreCompleto}</td>
        <td style="padding: 0.6rem; color: var(--text-secondary);">${fechaNac}</td>
        <td style="padding: 0.6rem; color: var(--text-secondary); text-transform: capitalize;">${sexo}</td>
        <td style="padding: 0.6rem; color: var(--text-secondary); font-family: monospace;">${dni}</td>
        <td style="padding: 0.6rem; text-align: right; color: var(--text-secondary); font-weight: 600; font-family: monospace;">${licencia}</td>
      `;
    } else {
      const nombre = item.nombre || item.nombreCompleto || "Sin nombre";
      const dni = item.dni || item.nif || "Sin DNI";
      const genero = item.genero || item.sexo || "-";
      const fechaNac = item.fechaNacimiento || item.nacimiento || "-";
      const edad = calcularEdad(fechaNac);
      const textoEdad = edad !== null ? `${fechaNac} (${edad} años)` : fechaNac;
      const fechaAlta = item.fechaAlta || item.createdAt ? new Date(item.fechaAlta || item.createdAt).toLocaleDateString() : "-";

      tr.innerHTML = `
        <td style="padding: 0.6rem; font-weight: 500; color: var(--text-main);">${nombre}</td>
        <td style="padding: 0.6rem; color: var(--text-secondary); font-family: monospace;">${dni}</td>
        <td style="padding: 0.6rem; color: var(--text-secondary); text-transform: capitalize;">${genero}</td>
        <td style="padding: 0.6rem; color: var(--text-secondary);">${textoEdad}</td>
        <td style="padding: 0.6rem; text-align: right; color: var(--text-secondary); font-weight: 500;">${fechaAlta}</td>
      `;
    }
    tablaBody.appendChild(tr);
  });

  if (textoPaginacionInfo) textoPaginacionInfo.textContent = `Mostrando ${inicio + 1}-${fin} de ${infoUsuariosCache.length}`;
  if (textoPaginaActual) textoPaginaActual.textContent = `${paginaActualInfo} / ${totalPaginas}`;
  if (btnAnterior) btnAnterior.disabled = paginaActualInfo <= 1;
  if (btnSiguiente) btnSiguiente.disabled = paginaActualInfo >= totalPaginas;
}

// ==========================================
// POPUPS / ALERTAS GLOBALES ELEGANTES
// ==========================================

function mostrarPopupConfirmacion(titulo, texto, callbackConfirmacion) {
  let overlay = document.getElementById("modalEleganteConfirmacion");

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "modalEleganteConfirmacion";
    overlay.className = "modal-overlay-elegante";
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="modal-card-elegante">
      <div style="width: 56px; height: 56px; border-radius: 50%; background: #fee2e2; color: #ef4444; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem auto; box-shadow: 0 0 0 8px #fef2f2;">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
      </div>
      <h3 style="margin-bottom: 0.5rem; font-size: 1.25rem; font-weight: 600; color: var(--text-main, #0f172a);">${titulo}</h3>
      <p style="font-size: 0.95rem; color: var(--text-secondary, #475569); margin-bottom: 1.5rem; line-height: 1.5;">${texto}</p>
      <div style="display: flex; gap: 0.75rem;">
        <button type="button" id="btnCancelarConfirmacion" style="flex: 1; border-radius: 8px; padding: 0.65rem; font-weight: 500; background: #f1f5f9; border: 1px solid #cbd5e1; cursor: pointer; color: #334155;">Cancelar</button>
        <button type="button" id="btnAceptarConfirmacion" style="flex: 1; border-radius: 8px; padding: 0.65rem; font-weight: 500; background-color: #ef4444; color: #fff; border: none; cursor: pointer;">Aceptar</button>
      </div>
    </div>
  `;

  overlay.style.display = "flex";
  requestAnimationFrame(() => overlay.classList.add("activo"));

  const cerrar = () => {
    overlay.classList.remove("activo");
    setTimeout(() => { overlay.style.display = "none"; }, 250);
  };

  document.getElementById("btnCancelarConfirmacion").onclick = cerrar;
  document.getElementById("btnAceptarConfirmacion").onclick = () => {
    cerrar();
    if (callbackConfirmacion) callbackConfirmacion();
  };
  overlay.onclick = (e) => { if (e.target === overlay) cerrar(); };
}

function mostrarPopupEleganteExito(titulo, texto, callbackCierre = null) {
  let overlay = document.getElementById("modalEleganteGlobal");

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "modalEleganteGlobal";
    overlay.className = "modal-overlay-elegante";
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="modal-card-elegante">
      <div style="width: 56px; height: 56px; border-radius: 50%; background: #dcfce7; color: #16a34a; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem auto; box-shadow: 0 0 0 8px #f0fdf4;">
        <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
      </div>
      <h3 style="margin-bottom: 0.5rem; font-size: 1.25rem; font-weight: 600; color: var(--text-main, #0f172a);">${titulo}</h3>
      <p style="font-size: 0.95rem; color: var(--text-secondary, #475569); margin-bottom: 1.5rem; line-height: 1.5;">${texto}</p>
      <button type="button" id="btnCerrarPopupElegante" style="width: 100%; border-radius: 8px; padding: 0.65rem; font-weight: 500; background: #f1f5f9; border: 1px solid #cbd5e1; cursor: pointer;">Aceptar</button>
    </div>
  `;

  overlay.style.display = "flex";
  requestAnimationFrame(() => overlay.classList.add("activo"));

  const cerrar = () => {
    overlay.classList.remove("activo");
    setTimeout(() => {
      overlay.style.display = "none";
      if (callbackCierre) callbackCierre();
    }, 250);
  };

  document.getElementById("btnCerrarPopupElegante").onclick = cerrar;
  overlay.onclick = (e) => { if (e.target === overlay) cerrar(); };
}

function mostrarPopupEleganteError(titulo, texto) {
  let overlay = document.getElementById("modalEleganteErrorGlobal");

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "modalEleganteErrorGlobal";
    overlay.className = "modal-overlay-elegante";
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="modal-card-elegante">
      <div style="width: 56px; height: 56px; border-radius: 50%; background: #fee2e2; color: #ef4444; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem auto; box-shadow: 0 0 0 8px #fef2f2;">
        <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      </div>
      <h3 style="margin-bottom: 0.5rem; font-size: 1.25rem; font-weight: 600; color: var(--text-main, #0f172a);">${titulo}</h3>
      <p style="font-size: 0.95rem; color: var(--text-secondary, #475569); margin-bottom: 1.5rem; line-height: 1.5;">${texto}</p>
      <button type="button" id="btnCerrarPopupErrorElegante" style="width: 100%; border-radius: 8px; padding: 0.65rem; font-weight: 500; background: #f1f5f9; border: 1px solid #cbd5e1; cursor: pointer;">Entendido</button>
    </div>
  `;

  overlay.style.display = "flex";
  requestAnimationFrame(() => overlay.classList.add("activo"));

  const cerrar = () => {
    overlay.classList.remove("activo");
    setTimeout(() => { overlay.style.display = "none"; }, 250);
  };

  document.getElementById("btnCerrarPopupErrorElegante").onclick = cerrar;
  overlay.onclick = (e) => { if (e.target === overlay) cerrar(); };
}