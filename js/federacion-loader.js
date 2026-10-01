import { db, auth } from "./firebase-config.js";
import { collection, query, where, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

let currentUserOrgId = null;
let federacionGlobalCache = [];
let editandoId = null;
let idParaEliminar = null;

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

// Función auxiliar para buscar el sexo en la colección "socios"
async function obtenerSexoDesdeSocios(orgId, dni, nombre, apellidos) {
  try {
    const sociosRef = collection(db, "socios");
    
    // 1. Intentar buscar por DNI si existe
    if (dni && dni.trim() !== "") {
      const qDni = query(sociosRef, where("organizationId", "==", orgId), where("dni", "==", dni.trim()));
      const snapDni = await getDocs(qDni);
      if (!snapDni.empty) {
        const socioData = snapDni.docs[0].data();
        if (socioData.sexo || socioData.genero) {
          return socioData.sexo || socioData.genero;
        }
      }
    }

    // 2. Si no se encuentra por DNI, buscar por coincidencia de nombre y apellidos
    const qSocios = query(sociosRef, where("organizationId", "==", orgId));
    const snapSocios = await getDocs(qSocios);
    
    const nombreBuscado = (nombre || "").toLowerCase().trim();
    const apellidosBuscados = (apellidos || "").toLowerCase().trim();

    for (const docSocio of snapSocios.docs) {
      const data = docSocio.data();
      const sNombre = (data.nombre || "").toLowerCase().trim();
      const sApellidos = (data.apellidos || "").toLowerCase().trim();

      if (sNombre === nombreBuscado && sApellidos === apellidosBuscados) {
        if (data.sexo || data.genero) {
          return data.sexo || data.genero;
        }
      }
    }
  } catch (error) {
    console.error("Error al consultar el sexo en socios:", error);
  }
  return "-"; // Valor por defecto si no se encuentra
}

// Función auxiliar para mostrar el modal de éxito elegante
function mostrarModalExito(mensaje) {
  const modal = document.getElementById('modalExito');
  const texto = document.getElementById('mensajeExitoTexto');
  if (texto) texto.textContent = mensaje;
  if (modal) modal.style.display = 'flex';
}

// Configurar eventos generales de cierre de modales informativos
document.addEventListener("DOMContentLoaded", () => {
  const btnCerrarExito = document.getElementById('btnCerrarModalExito');
  const modalExito = document.getElementById('modalExito');

  if (btnCerrarExito) {
    btnCerrarExito.addEventListener('click', () => {
      if (modalExito) modalExito.style.display = 'none';
    });
  }

  if (modalExito) {
    modalExito.addEventListener('click', (e) => {
      if (e.target.id === 'modalExito') {
        modalExito.style.display = 'none';
      }
    });
  }

  // Configurar eventos del modal de confirmación de eliminación
  const btnCancelarEliminar = document.getElementById('btnCancelarEliminar');
  const btnConfirmarEliminar = document.getElementById('btnConfirmarEliminar');
  const modalConfirmar = document.getElementById('modalConfirmarEliminar');

  if (btnCancelarEliminar) {
    btnCancelarEliminar.addEventListener('click', () => {
      if (modalConfirmar) modalConfirmar.style.display = 'none';
      idParaEliminar = null;
    });
  }

  if (btnConfirmarEliminar) {
    btnConfirmarEliminar.addEventListener('click', async () => {
      if (modalConfirmar) modalConfirmar.style.display = 'none';
      if (idParaEliminar) {
        await ejecutarEliminacionFederado(idParaEliminar);
      }
    });
  }

  if (modalConfirmar) {
    modalConfirmar.addEventListener('click', (e) => {
      if (e.target.id === 'modalConfirmarEliminar') {
        modalConfirmar.style.display = 'none';
        idParaEliminar = null;
      }
    });
  }
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const userDocRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) return;

      const userData = userDoc.data();
      currentUserOrgId = userData.organizationId || userData.orgId || userData.companyId;

      if (!currentUserOrgId) {
        mostrarMensajeTabla("El usuario no está vinculado a ninguna organización.");
        return;
      }

      await cargarFederadosDeOrg(currentUserOrgId);
      inicializarBuscadorFederacion();
      inicializarModalEventos();

    } catch (error) {
      console.error("Error al obtener la organización:", error);
    }
  }
});

async function cargarFederadosDeOrg(orgId) {
  try {
    const q = query(collection(db, "federacion"), where("organizationId", "==", orgId));
    const querySnapshot = await getDocs(q);
    
    federacionGlobalCache = [];
    
    for (const docSnap of querySnapshot.docs) {
      const data = docSnap.data();
      let sexoFederado = data.sexo;

      // Si el federado no tiene sexo guardado, lo buscamos en la colección socios
      if (!sexoFederado || sexoFederado === "-") {
        sexoFederado = await obtenerSexoDesdeSocios(orgId, data.dni, data.nombre, data.apellidos);
      }

      federacionGlobalCache.push({ 
        id: docSnap.id, 
        ...data, 
        sexo: sexoFederado !== "-" ? sexoFederado : "-" 
      });
    }

    federacionGlobalCache.sort((a, b) => {
      const nombreA = (a.nombre || "").toLowerCase();
      const nombreB = (b.nombre || "").toLowerCase();
      return nombreA.localeCompare(nombreB, 'es', { sensitivity: 'base' });
    });

    renderizarTablaFederacion(federacionGlobalCache);

  } catch (error) {
    console.error("Error al cargar los datos de federación:", error);
    mostrarMensajeTabla("Error al cargar los datos.");
  }
}

function renderizarTablaFederacion(listaFederados) {
  const tableBody = document.getElementById("federacionTableBody");
  if (!tableBody) return;

  tableBody.innerHTML = "";

  if (listaFederados.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 2rem;">No se encontraron registros federativos.</td></tr>`;
    return;
  }

  listaFederados.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${item.nombre || ""} ${item.apellidos || ""}</strong></td>
      <td>${item.nacimiento || "No especificada"}</td>
      <td>${item.sexo || "-"}</td>
      <td>${item.dni || "Sin DNI"}</td>
      <td><span class="badge-status active">${item.licencia || "Sin licencia"}</span></td>
      <td style="text-align: right;">
        <div style="display: inline-flex; gap: 0.5rem; justify-content: flex-end;">
          <button class="btn-icon-action btn-editar" title="Editar">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <button class="btn-icon-action btn-danger-action btn-eliminar" title="Eliminar">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </td>
    `;
    
    tr.querySelector(".btn-editar").addEventListener("click", () => abrirModalEdicion(item));
    tr.querySelector(".btn-eliminar").addEventListener("click", () => solicitarEliminarFederado(item.id));

    tableBody.appendChild(tr);
  });
}

function inicializarBuscadorFederacion() {
  const inputFiltro = document.getElementById("filtroFederadosGeneral");

  if (inputFiltro) {
    inputFiltro.addEventListener("input", (e) => {
      const texto = e.target.value.toLowerCase().trim();

      const filtrados = federacionGlobalCache.filter(item => {
        const nombreCompleto = `${item.nombre || ""} ${item.apellidos || ""}`.toLowerCase();
        const dni = (item.dni || "").toLowerCase();
        const licencia = (item.licencia || "").toLowerCase();

        return nombreCompleto.includes(texto) || dni.includes(texto) || licencia.includes(texto);
      });

      renderizarTablaFederacion(filtrados);
    });
  }
}

function mostrarMensajeTabla(mensaje) {
  const tableBody = document.getElementById("federacionTableBody");
  if (tableBody) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 2rem;">${mensaje}</td></tr>`;
  }
}

function inicializarModalEventos() {
  const modal = document.getElementById("modalFederado");
  const btnNuevo = document.getElementById("btnNuevoFederado");
  const btnCerrar = document.getElementById("btnCerrarModalFederado");
  const btnCancelar = document.getElementById("btnCancelarFederado");
  const form = document.getElementById("formFederado");

  if (btnNuevo) {
    btnNuevo.addEventListener("click", () => {
      editandoId = null;
      document.getElementById("modalFederadoTitulo").textContent = "Añadir Nuevo Federado";
      if (form) form.reset();
      if (modal) modal.style.display = "flex";
    });
  }

  const cerrarModalFunc = () => {
    if (modal) modal.style.display = "none";
    if (form) form.reset();
    editandoId = null;
  };

  if (btnCerrar) btnCerrar.addEventListener("click", cerrarModalFunc);
  if (btnCancelar) btnCancelar.addEventListener("click", cerrarModalFunc);

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      if (!currentUserOrgId) {
        mostrarModalExito("Error: Organización no detectada.");
        return;
      }

      const nombreInput = document.getElementById("fedNombre").value.trim();
      const apellidosInput = document.getElementById("fedApellidos").value.trim();
      const dniInput = document.getElementById("fedDni").value.trim();

      // Consulta automática del sexo en la colección "socios"
      const sexoAutomatico = await obtenerSexoDesdeSocios(currentUserOrgId, dniInput, nombreInput, apellidosInput);

      const datosFederado = {
        nombre: nombreInput,
        apellidos: apellidosInput,
        nacimiento: document.getElementById("fedNacimiento").value,
        sexo: sexoAutomatico, // Asignado automáticamente desde socios
        dni: dniInput,
        licencia: document.getElementById("fedLicencia").value.trim(),
        organizationId: currentUserOrgId
      };

      try {
        if (editandoId) {
          const docRef = doc(db, "federacion", editandoId);
          await updateDoc(docRef, datosFederado);
          
          await registrarLog(`FEDERADOS: Actualización de datos del federado: ${datosFederado.nombre} ${datosFederado.apellidos} (DNI: ${datosFederado.dni})`);

          cerrarModalFunc();
          mostrarModalExito("Registro actualizado con éxito.");
        } else {
          datosFederado.createdAt = new Date();
          await addDoc(collection(db, "federacion"), datosFederado);

          await registrarLog(`FEDERADOS: Creación de nuevo federado: ${datosFederado.nombre} ${datosFederado.apellidos} (DNI: ${datosFederado.dni})`);

          cerrarModalFunc();
          mostrarModalExito("Federado registrado con éxito.");
        }

        await cargarFederadosDeOrg(currentUserOrgId);
      } catch (error) {
        console.error("Error al guardar federado:", error);
        mostrarModalExito("Hubo un error al guardar los datos.");
      }
    });
  }
}

function abrirModalEdicion(item) {
  editandoId = item.id;
  document.getElementById("modalFederadoTitulo").textContent = "Editar Datos de Federado";
  
  document.getElementById("fedNombre").value = item.nombre || "";
  document.getElementById("fedApellidos").value = item.apellidos || "";
  document.getElementById("fedNacimiento").value = item.nacimiento || "";
  document.getElementById("fedDni").value = item.dni || "";
  document.getElementById("fedLicencia").value = item.licencia || "";

  document.getElementById("modalFederado").style.display = "flex";
}

function solicitarEliminarFederado(id) {
  idParaEliminar = id;
  const modalConfirmar = document.getElementById("modalConfirmarEliminar");
  if (modalConfirmar) {
    modalConfirmar.style.display = "flex";
  }
}

async function ejecutarEliminacionFederado(id) {
  try {
    const federadoItem = federacionGlobalCache.find(item => item.id === id);

    await deleteDoc(doc(db, "federacion", id));

    if (federadoItem) {
      await registrarLog(`FEDERADOS: Eliminación del federado: ${federadoItem.nombre || "Sin nombre"} ${federadoItem.apellidos || ""} (DNI: ${federadoItem.dni || "Sin DNI"})`);
    }

    mostrarModalExito("Registro eliminado correctamente.");
    await cargarFederadosDeOrg(currentUserOrgId);
  } catch (error) {
    console.error("Error al eliminar el registro:", error);
    mostrarModalExito("Hubo un error al intentar eliminar el registro.");
  } finally {
    idParaEliminar = null;
  }
}