<?php
// Recibir los datos JSON enviados desde JavaScript
$input = json_decode(file_get_contents('php://input'), true);

if ($input) {
    $email = $input['emailUsuario'];
    $uid = $input['uidUsuario'];
    $orgId = $input['orgId'];
    $fecha = $input['fecha'];

    $destinatario = "clientesflexia@gmail.com";
    $asunto = "⚠️ Solicitud de baja y borrado de Auth - Organismo: " . $orgId;
    
    $mensaje = "Se ha solicitado la eliminación total de una organización en Portal Flexia.\n\n";
    $mensaje .= "Detalles para eliminar manualmente en Firebase Auth:\n";
    $mensaje .= "- Correo del usuario: " . $email . "\n";
    $mensaje .= "- UID de Firebase Auth: " . $uid . "\n";
    $mensaje .= "- ID de la Organización: " . $orgId . "\n";
    $mensaje .= "- Fecha: " . $fecha . "\n\n";
    $mensaje .= "Por favor, entra a la consola de Firebase y elimina este usuario de Authentication.";

    $headers = "From: noreply@portal-flexia.com";

    // Enviar correo
    @mail($destinatario, $asunto, $mensaje, $headers);
    
    echo json_encode(["status" => "success"]);
} else {
    echo json_encode(["status" => "error", "message" => "Sin datos"]);
}
?>