package com.alanya.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "conversation")
public class Conversation {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "conversId")
    private Long id;

    // Les membres sont stockes dans la table conversation_member
    // (voir entite ConversationMember). Cela permet les conversations
    // 1-to-1 ET les groupes a 3+ personnes.

    @Column(name = "isGroup")
    private Boolean isGroup = false;

    @Column(name = "GroupName", length = 255)
    private String groupName;

    @Column(name = "groupPhoto", length = 255)
    private String groupPhoto;

    @Column(name = "lastMessageText", columnDefinition = "TEXT")
    private String lastMessageText;

    @Column(name = "lastMessageAt")
    private LocalDateTime lastMessageAt;

    @Column(name = "isPinned")
    private Boolean isPinned = false;

    @Column(name = "isArchived")
    private Boolean isArchived = false;

    @Column(name = "unreadCount")
    private Short unreadCount = 0;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Boolean getIsGroup() { return isGroup; }
    public void setIsGroup(Boolean isGroup) { this.isGroup = isGroup; }
    public String getGroupName() { return groupName; }
    public void setGroupName(String groupName) { this.groupName = groupName; }
    public String getGroupPhoto() { return groupPhoto; }
    public void setGroupPhoto(String groupPhoto) { this.groupPhoto = groupPhoto; }
    public String getLastMessageText() { return lastMessageText; }
    public void setLastMessageText(String lastMessageText) { this.lastMessageText = lastMessageText; }
    public LocalDateTime getLastMessageAt() { return lastMessageAt; }
    public void setLastMessageAt(LocalDateTime lastMessageAt) { this.lastMessageAt = lastMessageAt; }
    public Boolean getIsPinned() { return isPinned; }
    public void setIsPinned(Boolean isPinned) { this.isPinned = isPinned; }
    public Boolean getIsArchived() { return isArchived; }
    public void setIsArchived(Boolean isArchived) { this.isArchived = isArchived; }
    public Short getUnreadCount() { return unreadCount; }
    public void setUnreadCount(Short unreadCount) { this.unreadCount = unreadCount; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
