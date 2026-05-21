package com.alanya.dto.request;

import jakarta.validation.constraints.NotBlank;

public class CreateCallRequest {

    @NotBlank(message = "contactId est obligatoire.")
    private String contactId;

    /** "audio" (defaut) ou "video". */
    private String type;

    public String getContactId() { return contactId; }
    public void setContactId(String contactId) { this.contactId = contactId; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
}
