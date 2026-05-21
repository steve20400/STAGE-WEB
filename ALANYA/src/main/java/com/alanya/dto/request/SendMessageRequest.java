package com.alanya.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public class SendMessageRequest {

    @NotBlank(message = "Le contenu du message est obligatoire.")
    @Size(max = 4000, message = "Message trop long.")
    private String content;

    /** Optionnel : "text" (defaut), "file", "audio", "image". */
    private String type;

    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
}
