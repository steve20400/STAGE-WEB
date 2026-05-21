package com.alanya.dto.response;

import java.time.LocalDateTime;

public class MessageResponse {
    private String id;
    private String conversationId;
    private String senderId;     // phone du sender (conforme au contrat front)
    private String content;
    private String type;         // "text" | "file" | "audio" | "image"
    private String status;       // "sent" | "delivered" | "read" | "failed"
    private LocalDateTime createdAt;

    public MessageResponse() {}

    public MessageResponse(String id, String conversationId, String senderId, String content,
                           String type, String status, LocalDateTime createdAt) {
        this.id = id;
        this.conversationId = conversationId;
        this.senderId = senderId;
        this.content = content;
        this.type = type;
        this.status = status;
        this.createdAt = createdAt;
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getConversationId() { return conversationId; }
    public void setConversationId(String conversationId) { this.conversationId = conversationId; }
    public String getSenderId() { return senderId; }
    public void setSenderId(String senderId) { this.senderId = senderId; }
    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
