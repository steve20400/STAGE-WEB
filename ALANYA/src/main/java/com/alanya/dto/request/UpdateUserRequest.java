package com.alanya.dto.request;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Size;

/**
 * Tous les champs sont optionnels : c'est un PATCH partiel.
 * Seuls les champs non-null sont appliques.
 */
public class UpdateUserRequest {

    @Size(min = 2, max = 60, message = "Le nom doit faire entre 2 et 60 caracteres.")
    private String name;

    @Email(message = "Adresse email invalide.")
    private String email;

    @Size(max = 100, message = "Le statut ne peut pas depasser 100 caracteres.")
    private String statusMsg;

    private String avatar;

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
    public String getStatusMsg() { return statusMsg; }
    public void setStatusMsg(String statusMsg) { this.statusMsg = statusMsg; }
    public String getAvatar() { return avatar; }
    public void setAvatar(String avatar) { this.avatar = avatar; }
}
