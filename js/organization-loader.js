import { db, auth } from "./firebase-config.js";
import { doc, getDoc, updateDoc, serverTimestamp, collection, addDoc, getDocs, query, where, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

let currentUserOrgId = null;
let organizacionDataGlobal = null; 

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

      await inicializarVistaOrganizacion(currentUserOrgId);
      inicializarModalOrganizacion(); 
      inicializarEliminarOrganizacion(); 
      inicializarFechaJuntaUI(); 
      await cargarMiembrosJunta(currentUserOrgId); 

    } catch (error) {
      console.error("Error al inicializar datos:", error);
    }
  }
});

async function inicializarVistaOrganizacion(orgId) {
  try {
    const orgDocRef = doc(db, "organizations", orgId);
    const orgSnap = await getDoc(orgDocRef);

    if (!orgSnap.exists()) {
      console.error("Organización no encontrada");
      return;
    }

    organizacionDataGlobal = orgSnap.data();
    organizacionDataGlobal.id = orgSnap.id; 

    await verificarCodigosSistema(orgDocRef, organizacionDataGlobal);
    renderizarTablaResumen(organizacionDataGlobal);
    actualizarVistaFechaJunta(organizacionDataGlobal.fechaJunta);

  } catch (error) {
    console.error("Error cargando organización:", error);
  }
}

function renderizarTablaResumen(data) {
  const tbody = document.getElementById("tablaOrganizacionesBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>
      <strong style="color: var(--text-primary); font-size: 1rem;">${data.name || "Sin nombre"}</strong>
    </td>
    <td>
      <div style="color: var(--text-primary);">
        NIF: ${data.cif || 'No definido'}
      </div>
    </td>
    <td>
      <div style="color: var(--text-primary);">
        ${data.codigoPrincipal || '...'}
      </div>
    </td>
    <td>
      <span class="badge-status active" style="text-transform: uppercase;">
        ${data.plan || "N/D"}
      </span>
    </td>
  `;
  tbody.appendChild(tr);
}

async function verificarCodigosSistema(docRef, data) {
  const updates = {};
  let codigosModificados = false;

  if (!data.codigoPrincipal) {
    updates.codigoPrincipal = `FLP_${generarNumeroAleatorio(6)}`;
    codigosModificados = true;
  }

  if (!data.createdAt) {
    updates.createdAt = serverTimestamp();
    codigosModificados = true;
  }

  if (codigosModificados) {
    try {
      await updateDoc(docRef, updates);
      Object.assign(organizacionDataGlobal, updates); 
    } catch (error) {
      console.error("Error al actualizar códigos de sistema en BD:", error);
    }
  }
}

function generarNumeroAleatorio(longitud) {
  let numero = '';
  for (let i = 0; i < longitud; i++) {
    numero += Math.floor(Math.random() * 10).toString();
  }
  return numero;
}

// --- GESTIÓN DE LA FECHA DE LA JUNTA EN ORGANIZATION ---
function actualizarVistaFechaJunta(fechaStr) {
  const spanValor = document.getElementById("spanFechaJuntaValor");
  const inputFecha = document.getElementById("inputFechaJunta");
  
  if (!spanValor || !inputFecha) return;

  if (fechaStr) {
    const partes = fechaStr.split("-");
    if (partes.length === 3) {
      spanValor.textContent = `${partes[2]}/${partes[1]}/${partes[0]}`;
    } else {
      spanValor.textContent = fechaStr;
    }
    inputFecha.value = fechaStr;
  } else {
    spanValor.textContent = "--/--/----";
    inputFecha.value = "";
  }
}

function inicializarFechaJuntaUI() {
  const btnEditar = document.getElementById("btnEditarFechaJunta");
  const btnGuardar = document.getElementById("btnGuardarFechaJunta");
  const spanValor = document.getElementById("spanFechaJuntaValor");
  const inputFecha = document.getElementById("inputFechaJunta");

  if (!btnEditar || !btnGuardar || !spanValor || !inputFecha) return;

  btnEditar.addEventListener("click", () => {
    spanValor.style.display = "none";
    btnEditar.style.display = "none";
    inputFecha.style.display = "inline-block";
    btnGuardar.style.display = "inline-block";
    inputFecha.focus();
  });

  btnGuardar.addEventListener("click", async () => {
    const nuevaFecha = inputFecha.value;
    if (!currentUserOrgId) return;

    try {
      btnGuardar.textContent = "...";
      btnGuardar.disabled = true;

      const orgDocRef = doc(db, "organizations", currentUserOrgId);
      await updateDoc(orgDocRef, { fechaJunta: nuevaFecha });

      organizacionDataGlobal.fechaJunta = nuevaFecha;
      actualizarVistaFechaJunta(nuevaFecha);

      await registrarLog(`ORGANIZACIÓN: Actualización de la fecha de la junta: ${nuevaFecha}`);

      inputFecha.style.display = "none";
      btnGuardar.style.display = "none";
      spanValor.style.display = "inline";
      btnEditar.style.display = "inline-flex";

      mostrarModalExito("Actualizado", "La fecha de la junta se ha guardado correctamente.");
    } catch (error) {
      console.error("Error al guardar la fecha de la junta:", error);
      mostrarModalError("Error", "No se pudo actualizar la fecha.");
    } finally {
      btnGuardar.textContent = "OK";
      btnGuardar.disabled = false;
    }
  });
}

function inicializarModalOrganizacion() {
  const modal = document.getElementById("modalDetalleOrg");
  const btnVer = document.getElementById("btnVerDetalleOrg");
  const btnCerrar = document.getElementById("btnCerrarModalOrg");
  const btnCancelar = document.getElementById("btnCancelarEdicionOrg");
  const btnEditar = document.getElementById("btnEditarOrgModal"); 
  const form = document.getElementById("formEditarOrg");

  if (btnVer) {
    btnVer.addEventListener("click", () => {
      rellenarModalConDatos(organizacionDataGlobal);
      modal.style.display = "flex";
      desactivarEdicion(); 
    });
  }

  const cerrarFn = () => {
    modal.style.display = "none";
    desactivarEdicion(); 
  };
  if (btnCerrar) btnCerrar.addEventListener("click", cerrarFn);
  if (btnCancelar) btnCancelar.addEventListener("click", cerrarFn);

  if (btnEditar) {
    btnEditar.addEventListener("click", activarEdicion);
  }

  if (form) {
    form.addEventListener("submit", guardarCambiosOrganizacion);
  }
}

function rellenarModalConDatos(data) {
  if (!data) return;

  const campos = {
    'Name': 'name',
    'Cif': 'cif',
    'Plan': 'plan',
    'Direccion': 'direccion',
    'Cp': 'codigoPostal',
    'Poblacion': 'poblacion',
    'Provincia': 'provincia',
    'Telefono': 'telefono',
    'Email': 'ownerEmail',
    'Flp': 'codigoPrincipal'
  };

  for (const [viewIdSuffix, dbField] of Object.entries(campos)) {
    const viewSpan = document.getElementById(`orgView${viewIdSuffix}`);
    const editInput = document.getElementById(`orgEdit${viewIdSuffix}`);

    const valor = data[dbField] || '';

    if (viewSpan) {
      if (dbField === 'createdAt') {
        viewSpan.textContent = data.createdAt ? data.createdAt.toDate().toLocaleDateString() : 'Pendiente...';
      } else if (dbField === 'plan') {
        viewSpan.textContent = valor.toUpperCase();
      } else {
        viewSpan.textContent = valor;
      }
    }
    
    if (editInput) {
      editInput.value = valor;
    }
  }
}

function activarEdicion() {
  const modal = document.getElementById("modalDetalleOrg");
  if (modal) {
    modal.classList.add("is-editing");
  }
  const inputName = document.getElementById("orgEditName");
  if (inputName) inputName.focus();
}

function desactivarEdicion() {
  const modal = document.getElementById("modalDetalleOrg");
  if (modal) {
    modal.classList.remove("is-editing");
  }
}

async function guardarCambiosOrganizacion(e) {
  e.preventDefault(); 

  const btnGuardar = document.getElementById("btnGuardarOrgModal");
  if (btnGuardar) {
    btnGuardar.textContent = "Guardando...";
    btnGuardar.disabled = true;
  }

  try {
    const formData = new FormData(e.target);
    const datosActualizados = {};
    
    const camposEditables = ['name', 'cif', 'direccion', 'codigoPostal', 'poblacion', 'provincia', 'telefono'];
    
    camposEditables.forEach(campo => {
      if (formData.has(campo)) {
        datosActualizados[campo] = formData.get(campo).trim();
      }
    });

    const orgDocRef = doc(db, "organizations", currentUserOrgId);
    await updateDoc(orgDocRef, datosActualizados);

    Object.assign(organizacionDataGlobal, datosActualizados);
    renderizarTablaResumen(organizacionDataGlobal);
    rellenarModalConDatos(organizacionDataGlobal);

    const nombreEntidad = datosActualizados.name || organizacionDataGlobal.name || "la entidad";
    await registrarLog(`ORGANIZACIÓN: Actualización de datos de la organización: ${nombreEntidad}`);

    desactivarEdicion();
    mostrarModalExito("¡Actualizado!", "Los datos de la organización se han guardado correctamente.");

  } catch (error) {
    console.error("Error al guardar cambios de la organización:", error);
    mostrarModalError("Error", "Hubo un error al intentar guardar los cambios.");
  } finally {
    if (btnGuardar) {
      btnGuardar.textContent = "Guardar Cambios";
      btnGuardar.disabled = false;
    }
  }
}

function inicializarEliminarOrganizacion() {
  const btnEliminarOrg = document.getElementById("btnEliminarOrgModal");
  if (!btnEliminarOrg) return;

  btnEliminarOrg.addEventListener("click", () => {
    if (!currentUserOrgId) {
      mostrarModalError("Error", "No se ha identificado la organización actual.");
      return;
    }

    mostrarModalConfirmacion(
      "¿Eliminar organización por completo?",
      "¡ATENCIÓN! Esta acción eliminará absolutamente todo lo relacionado con esta organización (miembros, pagos, configuraciones, perfil de la entidad y cuentas asociadas). Esta acción es irreversible.",
      async () => {
        await ejecutarEliminacionTotalOrganizacion(currentUserOrgId);
      }
    );
  });
}

async function ejecutarEliminacionTotalOrganizacion(orgId) {
  try {
    const user = auth.currentUser;

    await registrarLog(`ORGANIZACIÓN: Eliminación total y completa de la organización y sus datos asociados`);

    const coleccionesALimpiar = [
      "organizations_members",
      "pagos",
      "cuotas_config",
      "socios"
    ];

    for (const nombreColeccion of coleccionesALimpiar) {
      try {
        const q = query(collection(db, nombreColeccion), where("organizationId", "==", orgId));
        const snapshot = await getDocs(q);
        
        const promesasBorrado = snapshot.docs.map(docSnap => deleteDoc(docSnap.ref));
        await Promise.all(promesasBorrado);
      } catch (err) {
        console.warn(`No se pudo limpiar la colección ${nombreColeccion} o no existe:`, err);
      }
    }

    const orgDocRef = doc(db, "organizations", orgId);
    await deleteDoc(orgDocRef);

    try {
      const qUsers = query(collection(db, "users"), where("organizationId", "==", orgId));
      const snapshotUsers = await getDocs(qUsers);
      
      const promesasUsers = snapshotUsers.docs.map(userDocSnap => deleteDoc(userDocSnap.ref));
      await Promise.all(promesasUsers);
    } catch (errUsers) {
      console.warn("Error al limpiar usuarios asociados en Firestore:", errUsers);
    }

    if (user) {
      try {
        const datosNotificacion = {
          emailUsuario: user.email,
          uidUsuario: user.uid,
          orgId: orgId,
          fecha: new Date().toISOString()
        };

        await fetch("../php/enviar-aviso-baja.php", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(datosNotificacion)
        });

      } catch (phpErr) {
        console.warn("No se pudo enviar el correo de aviso, pero los datos de Firestore se borraron:", phpErr);
      }

      await signOut(auth);
    }

    const modal = document.getElementById("modalDetalleOrg");
    if (modal) modal.style.display = "none";

    mostrarModalExito(
      "Organización eliminada", 
      "Se han borrado todos los datos correctamente. Se ha notificado al administrador para proceder con el cierre total de la cuenta.", 
      () => {
        window.location.href = "../index.html";
      }
    );

  } catch (error) {
    console.error("Error crítico al eliminar la organización:", error);
    mostrarModalError("Error crítico", "Hubo un fallo al intentar eliminar todos los datos de la organización: " + error.message);
  }
}

function mostrarModalExito(titulo, texto, callbackCierre = null) {
  let modalExito = document.getElementById("modalAlertaExitoGlobal");
  
  if (!modalExito) {
    modalExito = document.createElement("div");
    modalExito.id = "modalAlertaExitoGlobal";
    modalExito.className = "modal-overlay";
    modalExito.style.cssText = "display: none; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px); z-index: 1300; align-items: center; justify-content: center; padding: 1rem;";
    document.body.appendChild(modalExito);
  }

  modalExito.innerHTML = `
    <div class="content-card" style="width: 100%; max-width: 400px; margin: auto; animation: fadeIn 0.2s ease; text-align: center; padding: 2.25rem 1.5rem; background: #fff; border-radius: 0.75rem; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);">
      <div style="width: 52px; height: 52px; border-radius: 50%; background: #dcfce7; color: #16a34a; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem auto;">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
      </div>
      <h3 style="margin-bottom: 0.5rem; font-size: 1.25rem; font-weight: 600; color: #0f172a;">${titulo}</h3>
      <p style="font-size: 0.925rem; color: #475569; margin-bottom: 0; line-height: 1.5;">${texto}</p>
    </div>
  `;

  modalExito.style.display = "flex";

  setTimeout(() => {
    modalExito.style.display = "none";
    if (callbackCierre) callbackCierre();
  }, 1500);
}

function mostrarModalError(titulo, texto) {
  let modalError = document.getElementById("modalAlertaErrorGlobal");
  
  if (!modalError) {
    modalError = document.createElement("div");
    modalError.id = "modalAlertaErrorGlobal";
    modalError.className = "modal-overlay";
    modalError.style.cssText = "display: none; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px); z-index: 1300; align-items: center; justify-content: center; padding: 1rem;";
    document.body.appendChild(modalError);
  }

  modalError.innerHTML = `
    <div class="content-card" style="width: 100%; max-width: 400px; margin: auto; animation: fadeIn 0.2s ease; text-align: center; padding: 2.25rem 1.5rem; background: #fff; border-radius: 0.75rem; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);">
      <div style="width: 52px; height: 52px; border-radius: 50%; background: #fee2e2; color: #ef4444; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem auto;">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      </div>
      <h3 style="margin-bottom: 0.5rem; font-size: 1.25rem; font-weight: 600; color: #0f172a;">${titulo}</h3>
      <p style="font-size: 0.925rem; color: #475569; margin-bottom: 1.5rem; line-height: 1.5;">${texto}</p>
      <button type="button" id="btnCerrarModalErrorGlobal" style="width: 100%; padding: 0.6rem; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 0.375rem; font-weight: 500; cursor: pointer;">Entendido</button>
    </div>
  `;

  modalError.style.display = "flex";
  document.getElementById("btnCerrarModalErrorGlobal").onclick = () => {
    modalError.style.display = "none";
  };
}

function mostrarModalConfirmacion(titulo, texto, onConfirmar) {
  let modalConfirm = document.getElementById("modalAlertaConfirmacionGlobal");
  
  if (!modalConfirm) {
    modalConfirm = document.createElement("div");
    modalConfirm.id = "modalAlertaConfirmacionGlobal";
    modalConfirm.className = "modal-overlay";
    modalConfirm.style.cssText = "display: none; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px); z-index: 1300; align-items: center; justify-content: center; padding: 1rem;";
    document.body.appendChild(modalConfirm);
  }

  modalConfirm.innerHTML = `
    <div class="content-card" style="width: 100%; max-width: 400px; margin: auto; animation: fadeIn 0.2s ease; text-align: center; padding: 2.25rem 1.5rem; background: #fff; border-radius: 0.75rem; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);">
      <div style="width: 52px; height: 52px; border-radius: 50%; background: #fee2e2; color: #ef4444; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem auto;">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
      </div>
      <h3 style="margin-bottom: 0.5rem; font-size: 1.25rem; font-weight: 600; color: #0f172a;">${titulo}</h3>
      <p style="font-size: 0.925rem; color: #475569; margin-bottom: 1.5rem; line-height: 1.5;">${texto}</p>
      <div style="display: flex; gap: 0.75rem;">
        <button type="button" id="btnCancelarConfirmGlobal" style="flex: 1; padding: 0.6rem; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 0.375rem; font-weight: 500; cursor: pointer; color: #334155;">Cancelar</button>
        <button type="button" id="btnAceptarConfirmGlobal" style="flex: 1; padding: 0.6rem; background: #ef4444; border: 1px solid #dc2626; border-radius: 0.375rem; font-weight: 500; cursor: pointer; color: #fff;">Eliminar</button>
      </div>
    </div>
  `;

  modalConfirm.style.display = "flex";

  const btnCancelar = document.getElementById("btnCancelarConfirmGlobal");
  const btnAceptar = document.getElementById("btnAceptarConfirmGlobal");

  btnCancelar.onclick = () => {
    modalConfirm.style.display = "none";
  };

  btnAceptar.onclick = () => {
    modalConfirm.style.display = "none";
    if (onConfirmar) onConfirmar();
  };
}

function obtenerPesoCargo(cargo) {
  if (!cargo) return 99;
  const c = cargo.toLowerCase().trim();

  if (c.includes("presidente") && !c.includes("vice")) return 1;
  if (c.includes("vicepresidente")) return 2;
  if (c.includes("secretario")) return 3;
  if (c.includes("tesorero")) return 4;
  if (c.includes("vocal")) return 5;
  if (c.includes("entrenador")) return 6;

  return 50;
}

function ordenarMiembrosJunta(miembrosArray) {
  return miembrosArray.sort((a, b) => {
    const pesoA = obtenerPesoCargo(a.cargo || "");
    const pesoB = obtenerPesoCargo(b.cargo || "");

    if (pesoA !== pesoB) {
      return pesoA - pesoB;
    }

    const nombreA = (a.nombre || "").toLowerCase();
    const nombreB = (b.nombre || "").toLowerCase();
    return nombreA.localeCompare(nombreB, 'es', { sensitivity: 'base' });
  });
}

// --- GESTIÓN DE MIEMBROS DE LA JUNTA (organizations_members) ---
async function cargarMiembrosJunta(orgId) {
  const tbody = document.getElementById("tablaMiembrosJuntaBody");
  if (!tbody) return;

  try {
    const q = query(collection(db, "organizations_members"), where("organizationId", "==", orgId));
    const querySnapshot = await getDocs(q);
    
    tbody.innerHTML = "";
    let miembros = [];
    
    querySnapshot.forEach((docSnap) => {
      miembros.push({ id: docSnap.id, ...docSnap.data() });
    });

    if (miembros.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted, #94a3b8); padding: 1rem;">No hay miembros registrados.</td></tr>`;
      return;
    }

    miembros = ordenarMiembrosJunta(miembros);

    miembros.forEach((miembro) => {
      const tr = document.createElement("tr");
      tr.style.borderBottom = "1px solid var(--border-color, #f1f5f9)";
      // ORDEN: Cargo en la Junta, Nombre, DNI, Acciones
      tr.innerHTML = `
        <td style="padding: 0.75rem 0.5rem;"><span class="badge-status active" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;">${miembro.cargo || ""}</span></td>
        <td style="padding: 0.75rem 0.5rem;">${miembro.nombre || ""}</td>
        <td style="padding: 0.75rem 0.5rem;">${miembro.dni || ""}</td>
        <td style="padding: 0.75rem 0.5rem; text-align: right;">
          <button class="btn-secondary btn-eliminar-miembro" data-id="${miembro.id}" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; background-color: transparent; color: var(--danger, #ef4444); border: 1px solid var(--danger, #ef4444);">Eliminar</button>
        </td>
      `;

      tr.querySelector(".btn-eliminar-miembro").addEventListener("click", () => {
        mostrarModalConfirmacion(
          "¿Eliminar miembro?",
          "¿Estás seguro de eliminar a este miembro de la junta? Esta acción no se puede deshacer.",
          async () => {
            try {
              await deleteDoc(doc(db, "organizations_members", miembro.id));

              await registrarLog(`ORGANIZACIÓN: Eliminación de miembro de la junta: ${miembro.nombre || ""} (DNI: ${miembro.dni || ""}) - (${miembro.cargo || "Sin cargo"})`);

              await cargarMiembrosJunta(currentUserOrgId);
              mostrarModalExito("Eliminado", "El miembro ha sido borrado de la junta.");
            } catch (e) {
              console.error("Error al eliminar miembro:", e);
              mostrarModalError("Error", "No se pudo eliminar al miembro.");
            }
          }
        );
      });

      tbody.appendChild(tr);
    });

  } catch (error) {
    console.error("Error al cargar los miembros de la junta:", error);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const modalMiembro = document.getElementById("modalMiembroJunta");
  const btnAbrirModalMiembro = document.getElementById("btnAgregarMiembroJunta");
  const btnCancelarMiembro = document.getElementById("btnCancelarMiembro");
  const formMiembro = document.getElementById("formMiembroJunta");

  if (btnAbrirModalMiembro) {
    btnAbrirModalMiembro.addEventListener("click", () => {
      formMiembro.reset();
      modalMiembro.style.display = "flex";
    });
  }

  if (btnCancelarMiembro) {
    btnCancelarMiembro.addEventListener("click", () => {
      modalMiembro.style.display = "none";
    });
  }

  if (formMiembro) {
    formMiembro.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentUserOrgId) return;

      const cargoVal = document.getElementById("miembroCargo").value.trim();
      const nombreVal = document.getElementById("miembroNombre").value.trim();
      const dniVal = document.getElementById("miembroDni").value.trim();

      const nuevoMiembro = {
        cargo: cargoVal,
        nombre: nombreVal,
        dni: dniVal, // Guardado como String
        organizationId: currentUserOrgId,
        createdAt: new Date()
      };

      try {
        await addDoc(collection(db, "organizations_members"), nuevoMiembro);

        await registrarLog(`ORGANIZACIÓN: Creación de nuevo miembro de la junta: ${nombreVal} (DNI: ${dniVal}) - (${cargoVal || "Sin cargo"})`);

        modalMiembro.style.display = "none";
        formMiembro.reset();
        mostrarModalExito("¡Guardado!", "Miembro de junta añadido correctamente.", async () => {
          await cargarMiembrosJunta(currentUserOrgId);
        });
      } catch (error) {
        console.error("Error al guardar miembro:", error);
        mostrarModalError("Error", "No se pudo guardar el registro: " + error.message);
      }
    });
  }
});