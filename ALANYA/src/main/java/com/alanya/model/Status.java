package com.alanya.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/**
 * Statut type WhatsApp (texte ou media, ephemere).
 */
@Entity
@Table(name = "status")
public class Status {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id")
    private Long id;

    @Column(name = "alanyaID", nullable = false)
    private Integer userId;

    @Column(name = "type")
    private Short type = 0;

    @Column(name = "text", columnDefinition = "TINYTEXT")
    private String text;

    @Column(name = "mediaUrl", length = 255)
    private String mediaUrl;

    @Column(name = "backgroundColor", length = 20)
    private String backgroundColor;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "expiredAt")
    private LocalDateTime expiredAt;

    @Column(name = "viewedBy")
    private Integer viewedBy = 0;

    @Column(name = "likedBy")
    private Integer likedBy = 0;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Integer getUserId() { return userId; }
    public void setUserId(Integer userId) { this.userId = userId; }
    public Short getType() { return type; }
    public void setType(Short type) { this.type = type; }
    public String getText() { return text; }
    public void setText(String text) { this.text = text; }
    public String getMediaUrl() { return mediaUrl; }
    public void setMediaUrl(String mediaUrl) { this.mediaUrl = mediaUrl; }
    public String getBackgroundColor() { return backgroundColor; }
    public void setBackgroundColor(String backgroundColor) { this.backgroundColor = backgroundColor; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getExpiredAt() { return expiredAt; }
    public void setExpiredAt(LocalDateTime expiredAt) { this.expiredAt = expiredAt; }
    public Integer getViewedBy() { return viewedBy; }
    public void setViewedBy(Integer viewedBy) { this.viewedBy = viewedBy; }
    public Integer getLikedBy() { return likedBy; }
    public void setLikedBy(Integer likedBy) { this.likedBy = likedBy; }
}
