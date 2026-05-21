package com.alanya.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(
    name = "message_read",
    uniqueConstraints = @UniqueConstraint(name = "unique_message_reader", columnNames = {"msgID", "alanyaID"})
)
public class MessageRead {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id")
    private Long id;

    @Column(name = "msgID", nullable = false)
    private Long messageId;

    @Column(name = "alanyaID", nullable = false)
    private Integer userId;

    @Column(name = "readAt")
    private LocalDateTime readAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getMessageId() { return messageId; }
    public void setMessageId(Long messageId) { this.messageId = messageId; }
    public Integer getUserId() { return userId; }
    public void setUserId(Integer userId) { this.userId = userId; }
    public LocalDateTime getReadAt() { return readAt; }
    public void setReadAt(LocalDateTime readAt) { this.readAt = readAt; }
}
