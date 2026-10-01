import { db, auth } from "./firebase-config.js";
import { collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

let currentUserOrgId = null;
let pagosGlobalCache = []; 
let conceptosCache = {}; // Guardaremos los conceptos aquí para asociarlos fácilmente

// Variables de Paginación
let paginaActual = 1;
const elementosPorPagina = 10;
let pagosFiltradosCache = []; 

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

      if (!userDoc.exists()) return;

      const userData = userDoc.data();
      currentUserOrgId = userData.organizationId || userData.orgId || userData.companyId;

      if (!currentUserOrgId) {
        console.error("Usuario sin organización asignada.");
        return;
      }

      await cargarConceptos(currentUserOrgId);
      await cargarHistorialPagosGlobal(currentUserOrgId);
      inicializarFiltrosPagos();
      inicializarBotonesPaginacion();
      inicializarBotonExportar();

    } catch (error) {
      console.error("Error al inicializar datos de cuotas:", error);
    }
  }
});

function obtenerTextoPeriodicidad(periodicidad, tipoUnidad = 'meses') {
  if (periodicidad === undefined || periodicidad === null || periodicidad === '') {
    return 'Pago único';
  }

  const num = parseInt(periodicidad, 10);
  if (isNaN(num) || num <= 0) {
    return 'Pago único';
  }

  const unidadLimpia = (tipoUnidad || '').toString().toLowerCase().trim();

  if (unidadLimpia.includes('dia')) {
    return num === 1 ? 'Cada 1 día' : `Cada ${num} días`;
  } else {
    switch (num) {
      case 1: return 'Cada 1 mes';
      case 3: return 'Cada 3 meses (Trimestral)';
      case 6: return 'Cada 6 meses (Semestral)';
      case 12: return 'Cada 1 año (Anual)';
      default: return `Cada ${num} meses`;
    }
  }
}

function calcularFechaVencimiento(pago) {
  let periodicidad = pago.periodicidad;
  let tipoUnidad = pago.tipoUnidad;

  // Si falta información en el pago, la recuperamos del concepto asociado en caché
  if ((periodicidad === undefined || periodicidad === null || tipoUnidad === undefined) && pago.nombreCuota && conceptosCache[pago.nombreCuota]) {
    periodicidad = conceptosCache[pago.nombreCuota].periodicidad;
    tipoUnidad = conceptosCache[pago.nombreCuota].tipoUnidad;
  }

  // Si sigue sin haber periodicidad o es explícitamente un pago único
  if (periodicidad === undefined || periodicidad === null || periodicidad === '' || periodicidad === 'unico') {
    return 'No vence (Pago único)';
  }

  const numPeriodicidad = parseInt(periodicidad, 10);
  if (isNaN(numPeriodicidad) || numPeriodicidad <= 0) {
    return 'No vence (Pago único)';
  }

  const fechaInicioStr = pago.fechaPago;
  if (!fechaInicioStr) return '-';

  const partes = fechaInicioStr.split('-');
  if (partes.length !== 3) return '-';

  const anio = parseInt(partes[0], 10);
  const mes = parseInt(partes[1], 10) - 1;
  const dia = parseInt(partes[2], 10);

  const fecha = new Date(anio, mes, dia);
  
  const unidadLimpia = (tipoUnidad || '').toString().toLowerCase().trim();

  // Sumamos días o meses según corresponda
  if (unidadLimpia.includes('dia')) {
    fecha.setDate(fecha.getDate() + numPeriodicidad);
  } else {
    fecha.setMonth(fecha.getMonth() + numPeriodicidad);
  }

  const anioRes = fecha.getFullYear();
  const mesRes = String(fecha.getMonth() + 1).padStart(2, '0');
  const diaRes = String(fecha.getDate()).padStart(2, '0');

  return `${anioRes}-${mesRes}-${diaRes}`;
}

// Función para cargar los conceptos y almacenarlos en caché
async function cargarConceptos(orgId) {
  const tbody = document.getElementById("configCuotasBody");
  if (!tbody) return;

  try {
    const q = query(collection(db, "cuotas_config"), where("organizationId", "==", orgId));
    const snap = await getDocs(q);
    
    tbody.innerHTML = "";
    conceptosCache = {}; // Reiniciamos caché

    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No hay conceptos de cuota definidos.</td></tr>`;
      return;
    }

    snap.forEach(docSnap => {
      const data = docSnap.data();
      const conceptoId = docSnap.id;

      if (data.nombre) {
        conceptosCache[data.nombre] = data;
      }

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${data.nombre || "Sin nombre"}</strong></td>
        <td>${data.importe !== undefined ? data.importe + "€" : "0.00€"}</td>
        <td>${obtenerTextoPeriodicidad(data.periodicidad, data.tipoUnidad)}</td>
        <td style="text-align: right; display: flex; gap: 0.5rem; justify-content: flex-end;">
          <button class="btn-secondary btn-editar-concepto" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">Editar</button>
          <button class="btn-secondary btn-eliminar-concepto" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; background-color: transparent; color: var(--danger, #ef4444); border: 1px solid var(--danger, #ef4444);">Eliminar</button>
        </td>
      `;

      tr.querySelector(".btn-editar-concepto").addEventListener("click", () => {
        abrirModalEditarConcepto(conceptoId, data);
      });

      tr.querySelector(".btn-eliminar-concepto").addEventListener("click", () => {
        mostrarModalConfirmacionBorradoConcepto(conceptoId, data.nombre || "este concepto");
      });

      tbody.appendChild(tr);
    });

    if (pagosGlobalCache.length > 0) {
      renderizarTablaPagosPaginada();
    }

  } catch (error) {
    console.error("Error cargando conceptos de cuota:", error);
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Error al cargar conceptos.</td></tr>`;
  }
}

function abrirModalEditarConcepto(id = null, datos = null) {
  const modalConfig = document.getElementById("modalNuevaConfig");
  const tituloModal = document.getElementById("tituloModalConfig");
  const inputId = document.getElementById("configId");
  const inputNombre = document.getElementById("configNombre");
  const inputImporte = document.getElementById("configImporte");
  const inputPeriodicidad = document.getElementById("configPeriodicidad");
  const inputTipoUnidad = document.getElementById("configTipoUnidad");

  if (datos) {
    if (tituloModal) tituloModal.textContent = "Editar Concepto de Cuota";
    if (inputId) inputId.value = id;
    if (inputNombre) inputNombre.value = datos.nombre || "";
    if (inputImporte) inputImporte.value = datos.importe || "";
    if (inputPeriodicidad) inputPeriodicidad.value = datos.periodicidad || "1";
    if (inputTipoUnidad) inputTipoUnidad.value = datos.tipoUnidad || "meses";
  } else {
    if (tituloModal) tituloModal.textContent = "Nuevo Concepto de Cuota";
    if (inputId) inputId.value = "";
    if (inputNombre) inputNombre.value = "";
    if (inputImporte) inputImporte.value = "";
    if (inputPeriodicidad) inputPeriodicidad.value = "1";
    if (inputTipoUnidad) inputTipoUnidad.value = "meses";
  }

  if (modalConfig) modalConfig.style.display = "flex";
}

function mostrarModalConfirmacionBorradoConcepto(conceptoId, nombreConcepto) {
  let modalBorrado = document.getElementById("modalConfirmarBorradoConcepto");
  
  if (!modalBorrado) {
    modalBorrado = document.createElement("div");
    modalBorrado.id = "modalConfirmarBorradoConcepto";
    modalBorrado.className = "modal-overlay";
    modalBorrado.style.cssText = "display: none; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px); z-index: 1200; align-items: center; justify-content: center; padding: 1rem;";
    document.body.appendChild(modalBorrado);
  }

  modalBorrado.innerHTML = `
    <div id="cajaContenidoBorradoConcepto" class="content-card" style="width: 100%; max-width: 440px; margin: auto; animation: fadeIn 0.2s ease; text-align: center; padding: 2rem 1.5rem;">
      <div id="iconoBorradoConceptoContainer" style="width: 48px; height: 48px; border-radius: 50%; background: #fee2e2; color: var(--danger, #ef4444); display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem auto;">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
      </div>
      <h3 id="tituloBorradoConceptoModal" class="card-item-title" style="margin-bottom: 0.5rem; font-size: 1.25rem;">¿Eliminar concepto de cuota?</h3>
      <p id="textoAvisoBorradoConcepto" style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 1.5rem; line-height: 1.5;">
        Vas a eliminar el concepto <strong>${nombreConcepto}</strong>. Esta acción no se puede deshacer.
      </p>
      <div id="botonesAccionBorradoConcepto" style="display: flex; gap: 0.75rem;">
        <button type="button" id="btnCancelarBorradoConcepto" class="btn-secondary" style="flex: 1;">Cancelar</button>
        <button type="button" id="btnConfirmarBorradoConcepto" class="btn-secondary" style="flex: 1; background-color: var(--danger, #ef4444); color: #fff; border-color: var(--danger, #ef4444);">Sí, eliminar</button>
      </div>
    </div>
  `;

  modalBorrado.style.display = "flex";

  const btnCancelar = document.getElementById("btnCancelarBorradoConcepto");
  const btnConfirmar = document.getElementById("btnConfirmarBorradoConcepto");

  btnCancelar.addEventListener("click", () => {
    modalBorrado.style.display = "none";
  });

  btnConfirmar.addEventListener("click", async () => {
    btnConfirmar.disabled = true;
    btnCancelar.disabled = true;
    btnConfirmar.textContent = "Eliminando...";

    try {
      const docRef = doc(db, "cuotas_config", conceptoId);
      await deleteDoc(docRef);

      // LOG DE ELIMINACIÓN DE CONCEPTO
      await registrarLog(`CUOTAS: Eliminación del concepto de cuota: ${nombreConcepto}`);

      const iconoContainer = document.getElementById("iconoBorradoConceptoContainer");
      iconoContainer.style.background = "#dcfce7";
      iconoContainer.style.color = "#16a34a";
      iconoContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      
      document.getElementById("tituloBorradoConceptoModal").textContent = "¡Eliminado con éxito!";
      document.getElementById("textoAvisoBorradoConcepto").textContent = "El concepto de cuota ha sido borrado correctamente.";
      document.getElementById("botonesAccionBorradoConcepto").style.display = "none";

      setTimeout(async () => {
        modalBorrado.style.display = "none";
        await cargarConceptos(currentUserOrgId);
      }, 1000);

    } catch (error) {
      console.error("Error al eliminar el concepto de cuota:", error);
      alert("Hubo un error al intentar eliminar el concepto.");
      modalBorrado.style.display = "none";
      btnConfirmar.disabled = false;
      btnCancelar.disabled = false;
    }
  });
}

async function cargarHistorialPagosGlobal(orgId) {
  const tbody = document.getElementById("historialPagosGlobal");
  if (!tbody) return;

  try {
    const q = query(
      collection(db, "pagos"), 
      where("organizationId", "==", orgId)
    );
    const snap = await getDocs(q);

    pagosGlobalCache = [];
    snap.forEach(docSnap => {
      const data = docSnap.data();
      if (data.organizationId === orgId) {
        pagosGlobalCache.push(data);
      }
    });

    pagosGlobalCache.sort((a, b) => new Date(b.fechaPago) - new Date(a.fechaPago));

    pagosFiltradosCache = [...pagosGlobalCache];
    paginaActual = 1;
    renderizarTablaPagosPaginada();

  } catch (error) {
    console.error("Error al cargar histórico global de pagos:", error);
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Error al cargar historial.</td></tr>`;
  }
}

function renderizarTablaPagosPaginada() {
  const tbody = document.getElementById("historialPagosGlobal");
  const infoPaginacion = document.getElementById("infoPaginacion");
  const btnAnterior = document.getElementById("btnPaginaAnterior");
  const btnSiguiente = document.getElementById("btnPaginaSiguiente");

  if (!tbody) return;

  tbody.innerHTML = "";

  if (pagosFiltradosCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No se encontraron pagos con los filtros seleccionados.</td></tr>`;
    if (infoPaginacion) infoPaginacion.textContent = "Mostrando 0 de 0 pagos";
    if (btnAnterior) btnAnterior.disabled = true;
    if (btnSiguiente) btnSiguiente.disabled = true;
    return;
  }

  const totalRegistros = pagosFiltradosCache.length;
  const totalPaginas = Math.ceil(totalRegistros / elementosPorPagina);

  if (paginaActual > totalPaginas) paginaActual = totalPaginas;
  if (paginaActual < 1) paginaActual = 1;

  const inicio = (paginaActual - 1) * elementosPorPagina;
  const fin = inicio + elementosPorPagina;
  const pagosPagina = pagosFiltradosCache.slice(inicio, fin);

  pagosPagina.forEach(pago => {
    const fechaVencimiento = calcularFechaVencimiento(pago);
    tbody.innerHTML += `
      <tr>
        <td><strong>${pago.socioNombre || "Socio desconocido"}</strong></td>
        <td>${pago.nombreCuota || "Cuota"}</td>
        <td>${pago.fechaPago || "-"}</td>
        <td>${fechaVencimiento}</td>
        <td style="text-align: right; font-weight: 600;">${pago.monto ? pago.monto + "€" : ""}</td>
      </tr>
    `;
  });

  if (infoPaginacion) {
    infoPaginacion.textContent = `Mostrando del ${inicio + 1} al ${Math.min(fin, totalRegistros)} de ${totalRegistros} pagos`;
  }

  if (btnAnterior) btnAnterior.disabled = paginaActual === 1;
  if (btnSiguiente) btnSiguiente.disabled = paginaActual >= totalPaginas;
}

function inicializarBotonesPaginacion() {
  const btnAnterior = document.getElementById("btnPaginaAnterior");
  const btnSiguiente = document.getElementById("btnPaginaSiguiente");

  if (btnAnterior) {
    btnAnterior.addEventListener("click", () => {
      if (paginaActual > 1) {
        paginaActual--;
        renderizarTablaPagosPaginada();
      }
    });
  }

  if (btnSiguiente) {
    btnSiguiente.addEventListener("click", () => {
      const totalPaginas = Math.ceil(pagosFiltradosCache.length / elementosPorPagina);
      if (paginaActual < totalPaginas) {
        paginaActual++;
        renderizarTablaPagosPaginada();
      }
    });
  }
}

function inicializarBotonExportar() {
  const btnExportar = document.getElementById("btnDescargarExcel");

  if (btnExportar) {
    btnExportar.addEventListener("click", () => {
      if (pagosFiltradosCache.length === 0) {
        alert("No hay datos para exportar.");
        return;
      }

      let csvContent = "\uFEFF";
      csvContent += "Socio;Concepto;Fecha Pago;Próximo Vencimiento;Importe\n";

      pagosFiltradosCache.forEach(pago => {
        const socio = `"${(pago.socioNombre || "Socio desconocido").replace(/"/g, '""')}"`;
        const concepto = `"${(pago.nombreCuota || "Cuota").replace(/"/g, '""')}"`;
        const fecha = `"${(pago.fechaPago || "-")}"`;
        const vencimiento = `"${calcularFechaVencimiento(pago)}"`;
        const monto = `"${(pago.monto !== undefined ? pago.monto + "€" : "")}"`;

        csvContent += [socio, concepto, fecha, vencimiento, monto].join(";") + "\n";
      });

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `historico_pagos_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  }
}

function inicializarFiltrosPagos() {
    const inputGeneral = document.getElementById("filtroGeneral");
    const inputFecha = document.getElementById("filtroFecha");
    const btnLimpiar = document.getElementById("btnLimpiarFiltros");
 
    const aplicarFiltros = () => {
      const textoBusqueda = inputGeneral ? inputGeneral.value.toLowerCase().trim() : "";
      const mesSeleccionado = inputFecha ? inputFecha.value : ""; 
 
      pagosFiltradosCache = pagosGlobalCache.filter(pago => {
        const nombreSocio = (pago.socioNombre || "").toLowerCase();
        const nombreCuota = (pago.nombreCuota || "").toLowerCase();
        const fechaPago = pago.fechaPago || ""; 
 
        const coincideTexto = nombreSocio.includes(textoBusqueda) || nombreCuota.includes(textoBusqueda);
        const coincideMes = mesSeleccionado ? fechaPago.startsWith(mesSeleccionado) : true;
 
        return coincideTexto && coincideMes;
      });
 
      paginaActual = 1;
      renderizarTablaPagosPaginada();
    };
 
    if (inputGeneral) inputGeneral.addEventListener("input", aplicarFiltros);
    if (inputFecha) inputFecha.addEventListener("change", aplicarFiltros);
 
    if (btnLimpiar) {
      btnLimpiar.addEventListener("click", () => {
        if (inputGeneral) inputGeneral.value = "";
        if (inputFecha) inputFecha.value = "";
        pagosFiltradosCache = [...pagosGlobalCache];
        paginaActual = 1;
        renderizarTablaPagosPaginada();
      });
    }
}

document.addEventListener("DOMContentLoaded", () => {
  const modalConfig = document.getElementById("modalNuevaConfig");
  const btnNuevaConfig = document.getElementById("btnNuevaConfig");
  const btnCerrarModalConfig = document.getElementById("btnCerrarModalConfig");
  const btnCancelarConfig = document.getElementById("btnCancelarConfig");
  const formConfig = document.getElementById("formNuevaConfig");

  if (btnNuevaConfig) btnNuevaConfig.addEventListener("click", () => abrirModalEditarConcepto());
  if (btnCerrarModalConfig) btnCerrarModalConfig.addEventListener("click", () => { modalConfig.style.display = "none"; formConfig.reset(); });
  if (btnCancelarConfig) btnCancelarConfig.addEventListener("click", () => { modalConfig.style.display = "none"; formConfig.reset(); });

  if (formConfig) {
    formConfig.addEventListener("submit", async (e) => {
      e.preventDefault();

      if (!currentUserOrgId) {
        alert("Error: No se ha detectado la organización del usuario.");
        return;
      }

      const id = document.getElementById("configId").value;
      const nombre = document.getElementById("configNombre").value;
      const importe = parseFloat(document.getElementById("configImporte").value);
      const periodicidad = document.getElementById("configPeriodicidad").value;
      const tipoUnidad = document.getElementById("configTipoUnidad").value;

      try {
        if (id) {
          const docRef = doc(db, "cuotas_config", id);
          await updateDoc(docRef, {
            nombre: nombre,
            importe: importe,
            periodicidad: periodicidad,
            tipoUnidad: tipoUnidad
          });

          // LOG DE ACTUALIZACIÓN DE CONCEPTO
          await registrarLog(`CUOTAS: Actualización del concepto de cuota: ${nombre} (${importe}€)`);
        } else {
          await addDoc(collection(db, "cuotas_config"), {
            nombre: nombre,
            importe: importe,
            periodicidad: periodicidad,
            tipoUnidad: tipoUnidad,
            organizationId: currentUserOrgId,
            createdAt: new Date()
          });

          // LOG DE CREACIÓN DE CONCEPTO
          await registrarLog(`CUOTAS: Creación de nuevo concepto de cuota: ${nombre} (${importe}€)`);
        }

        modalConfig.style.display = "none";
        formConfig.reset();
        await cargarConceptos(currentUserOrgId);
      } catch (error) {
        console.error("Error al guardar el concepto de cuota:", error);
        alert("Hubo un error al procesar el concepto.");
      }
    });
  }
});