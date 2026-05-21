package com.alanya.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "message")
public class Message {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "msgID")
    private Long id;
    
    @Column(name = "senderID", nullable = false)
    private Integer senderId;
    
    @Column(name = "conversationID", nullable = false)
    private Long conversationId;
    
    @Column(name = "content", columnDefinition = "TEXT")
    private String content;
    
    @Column(name = "type")
    private Short type = 0;
    
    @Column(name = "status")
    private Boolean status = false;
    
    @Column(name = "sendAt")
    private LocalDateTime sendAt;
    
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Integer getSenderId() { return senderId; }
    public void setSenderId(Integer senderId) { this.senderId = senderId; }
    public Long getConversationId() { return conversationId; }
    public void setConversationId(Long conversationId) { this.conversationId = conversationId; }
    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }
    public Short getType() { return type; }
    public void setType(Short type) { this.type = type; }
    public Boolean getStatus() { return status; }
    public void setStatus(Boolean status) { this.status = status; }
    public LocalDateTime getSendAt() { return sendAt; }
    public void setSendAt(LocalDateTime sendAt) { this.sendAt = sendAt; }
}
