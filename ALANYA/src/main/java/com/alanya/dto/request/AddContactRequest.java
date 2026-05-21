package com.alanya.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public class AddContactRequest {

    @NotBlank(message = "Numero de telephone requis.")
    @Pattern(regexp = "^\\+?[0-9]{8,15}$", message = "Format de telephone invalide.")
    private String phone;

    public String getPhone() { return phone; }
    public void setPhone(String phone) { this.phone = phone; }
}
