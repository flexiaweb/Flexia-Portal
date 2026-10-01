import { db, auth } from "./firebase-config.js";
import { doc, getDoc, updateDoc, collection, addDoc, getDocs, query, where, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

let currentUserOrgId = null;

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

      await cargarUsuariosOrganizacion(currentUserOrgId);
      inicializarModalUsuarios();

    } catch (error) {
      console.error("Error al inicializar la gestión de usuarios:", error);
    }
  }
});

// --- CARGAR USUARIOS DE LA COLECCIÓN "users" ---
async function cargarUsuariosOrganizacion(orgId) {
  const tbody = document.getElementById("tablaUsersMembersBody");
  if (!tbody) return;

  try {
    // 1. Obtenemos también los datos de la organización para identificar al ownerEmail
    let ownerEmailOrg = null;
    try {
      const orgDocRef = doc(db, "organizations", orgId);
      const orgDocSnap = await getDoc(orgDocRef);
      if (orgDocSnap.exists()) {
        const orgData = orgDocSnap.data();
        ownerEmailOrg = orgData.ownerEmail || orgData.email || orgData.adminEmail;
      }
    } catch (errOrg) {
      console.warn("No se pudo obtener el ownerEmail de la organización:", errOrg);
    }

    // 2. Consultamos los usuarios de la organización
    const q = query(collection(db, "users"), where("organizationId", "==", orgId));
    const querySnapshot = await getDocs(q);
    
    tbody.innerHTML = "";
    const usuarios = [];
    
    querySnapshot.forEach((docSnap) => {
      usuarios.push({ id: docSnap.id, ...docSnap.data() });
    });

    if (usuarios.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted, #94a3b8); padding: 1.5rem;">No hay usuarios registrados en esta organización.</td></tr>`;
      return;
    }

    usuarios.forEach((usuario) => {
        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid var(--border-color, #f1f5f9)";
        
        const rolTexto = usuario.role ? usuario.role.toUpperCase() : "USUARIO";
        const esOwner = ownerEmailOrg && usuario.email && (usuario.email.toLowerCase() === ownerEmailOrg.toLowerCase());
        
        // Determinar si está activo o pendiente
        const estaActivo = esOwner || usuario.activo === true;
  
        let estadoHtml = estaActivo 
          ? `<span style="color: #16a34a; background: #dcfce7; padding: 0.2rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: 600;">Activo</span>`
          : `<span style="color: #ca8a04; background: #fef9c3; padding: 0.2rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: 600;">Pendiente de acceso</span>`;
  
        let accionesHtml = "";
  
        if (esOwner) {
          accionesHtml = `<span style="color: var(--text-muted, #64748b); font-size: 0.8rem; font-style: italic;">Propietario</span>`;
        } else {
          // Botones dinámicos según si está activo o pendiente
          const botonActivarDesactivar = estaActivo
            ? `<button class="btn-secondary btn-toggle-estado" data-id="${usuario.id}" data-nuevo-estado="false" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; background-color: transparent; color: #ca8a04; border: 1px solid #ca8a04; border-radius: 0.375rem; cursor: pointer; margin-right: 0.5rem;">Bloquear</button>`
            : `<button class="btn-secondary btn-toggle-estado" data-id="${usuario.id}" data-nuevo-estado="true" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; background-color: #16a34a; color: #fff; border: 1px solid #16a34a; border-radius: 0.375rem; cursor: pointer; margin-right: 0.5rem;">Dar Acceso</button>`;
  
          accionesHtml = `
            ${botonActivarDesactivar}
            <button class="btn-secondary btn-eliminar-usuario" data-id="${usuario.id}" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; background-color: transparent; color: var(--danger, #ef4444); border: 1px solid var(--danger, #ef4444); border-radius: 0.375rem; cursor: pointer;">Eliminar</button>
          `;
        }
  
        tr.innerHTML = `
          <td style="padding: 0.85rem 0.5rem; color: var(--text-primary, #0f172a); font-weight: 500;">
            ${usuario.email || "Sin email"} ${esOwner ? '<span style="background: #e0f2fe; color: #0369a1; font-size: 0.65rem; padding: 0.1rem 0.35rem; border-radius: 0.25rem; margin-left: 0.35rem; font-weight: 600;">PRINCIPAL</span>' : ''}
          </td>
          <td style="padding: 0.85rem 0.5rem;">
            <div style="color: var(--text-primary); font-weight: 500;">${usuario.name || usuario.nombre || "Sin nombre"}</div>
            <span class="badge-status active" style="padding: 0.15rem 0.4rem; font-size: 0.7rem; text-transform: uppercase; margin-top: 0.2rem; display: inline-block;">${rolTexto}</span>
          </td>
          <td style="padding: 0.85rem 0.5rem;">${estadoHtml}</td>
          <td style="padding: 0.85rem 0.5rem; text-align: right;">${accionesHtml}</td>
        `;
  
        // Evento para cambiar el estado (Dar acceso / Bloquear)
        const btnToggle = tr.querySelector(".btn-toggle-estado");
        if (btnToggle) {
          btnToggle.addEventListener("click", async () => {
            const nuevoEstado = btnToggle.getAttribute("data-nuevo-estado") === "true";
            try {
              await updateDoc(doc(db, "users", usuario.id), { activo: nuevoEstado });

              // LOG DE CAMBIO DE ESTADO DE ACCESO
              const accionLog = nuevoEstado ? "Concesión de acceso" : "Bloqueo de acceso";
              await registrarLog(`GESTIÓN CUENTAS: ${accionLog} al usuario: ${usuario.email || usuario.name || usuario.id}`);

              await cargarUsuariosOrganizacion(currentUserOrgId);
              mostrarModalExito("Actualizado", nuevoEstado ? "Acceso concedido correctamente." : "Acceso revocado.");
            } catch (e) {
              console.error("Error al cambiar estado:", e);
              mostrarModalError("Error", "No se pudo actualizar el estado del usuario.");
            }
          });
        }
  
        // Evento de eliminar (siempre que no sea el owner)
        const btnEliminar = tr.querySelector(".btn-eliminar-usuario");
        if (btnEliminar) {
          btnEliminar.addEventListener("click", () => {
            mostrarModalConfirmacion(
              "¿Eliminar usuario?",
              "¿Estás seguro de eliminar este usuario de la organización?",
              async () => {
                try {
                  await deleteDoc(doc(db, "users", usuario.id));

                  // LOG DE ELIMINACIÓN DE USUARIO
                  await registrarLog(`GESTIÓN CUENTAS: Eliminación de usuario de la organización: ${usuario.email || usuario.name || usuario.id}`);

                  await cargarUsuariosOrganizacion(currentUserOrgId);
                  mostrarModalExito("Eliminado", "El usuario ha sido borrado correctamente.");
                } catch (e) {
                  console.error("Error al eliminar usuario:", e);
                  mostrarModalError("Error", "No se pudo eliminar al usuario.");
                }
              }
            );
          });
        }
  
        tbody.appendChild(tr);
      });

  } catch (error) {
    console.error("Error al cargar los usuarios:", error);
  }
}

// --- GESTIÓN DEL MODAL DE NUEVO USUARIO / AUTORIZACIÓN ---
function inicializarModalUsuarios() {
  const modal = document.getElementById("modalUserMember");
  const btnAbrir = document.getElementById("btnAbrirModalUsuario");
  const btnCancelar = document.getElementById("btnCancelarUserModal");
  const form = document.getElementById("formUserMember");

  if (btnAbrir) {
    btnAbrir.addEventListener("click", () => {
      if (form) form.reset();
      if (modal) modal.style.display = "flex";
    });
  }

  const cerrarModal = () => {
    if (modal) modal.style.display = "none";
  };

  if (btnCancelar) {
    btnCancelar.addEventListener("click", cerrarModal);
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentUserOrgId) return;

      const emailInput = document.getElementById("inputUserEmail").value.trim();
      const nombreInput = document.getElementById("inputUserNombre").value.trim();
      const btnGuardar = document.getElementById("btnGuardarUserModal");

      try {
        if (btnGuardar) {
          btnGuardar.textContent = "Guardando...";
          btnGuardar.disabled = true;
        }

        const nuevoUsuarioData = {
          email: emailInput,
          name: nombreInput,
          organizationId: currentUserOrgId,
          role: "user",
          activo: false,
          createdAt: serverTimestamp()
        };

        await addDoc(collection(db, "users"), nuevoUsuarioData);

        // LOG DE AUTORIZACIÓN / CREACIÓN DE NUEVO USUARIO
        await registrarLog(`GESTIÓN CUENTAS: Autorización de nuevo usuario: ${emailInput} (${nombreInput || "Sin nombre"})`);

        cerrarModal();
        if (form) form.reset();

        mostrarModalExito("¡Autorizado!", "El usuario se ha registrado correctamente.", async () => {
          await cargarUsuariosOrganizacion(currentUserOrgId);
        });

      } catch (error) {
        console.error("Error al guardar usuario:", error);
        mostrarModalError("Error", "No se pudo guardar el usuario: " + error.message);
      } finally {
        if (btnGuardar) {
          btnGuardar.textContent = "Guardar Autorización";
          btnGuardar.disabled = false;
        }
      }
    });
  }
}

// --- MODALES ELEGANTES GLOBALES ---
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
    modalConfirm.style.cssText = "display: none; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px); z-index: 1300; align-items: center; justifyContent: center; padding: 1rem;";
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