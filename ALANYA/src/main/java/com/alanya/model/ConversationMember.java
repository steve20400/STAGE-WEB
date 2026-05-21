package com.alanya.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/**
 * Lie un utilisateur (alanyaID) a une conversation (conversId).
 * Permet de gerer aussi bien les conversations 1-to-1 (2 entrees)
 * que les groupes (3+ entrees).
 */
@Entity
@Table(name = "conversation_member")
public class ConversationMember {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id")
    private Long id;

    @Column(name = "conversId", nullable = false)
    private Long conversationId;

    @Column(name = "alanyaID", nullable = false)
    private Integer userId;

    @Column(name = "joined_at")
    private LocalDateTime joinedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getConversationId() { return conversationId; }
    public void setConversationId(Long conversationId) { this.conversationId = conversationId; }
    public Integer getUserId() { return userId; }
    public void setUserId(Integer userId) { this.userId = userId; }
    public LocalDateTime getJoinedAt() { return joinedAt; }
    public void setJoinedAt(LocalDateTime joinedAt) { this.joinedAt = joinedAt; }
}
