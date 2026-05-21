package com.alanya.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "preferred_contact")
public class Contact {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "idPrefContact")
    private Long id;
    
    @Column(name = "alanyaID", nullable = false)
    private Integer userId;
    
    @Column(name = "idFriend", nullable = false)
    private Integer friendId;
    
    @Column(name = "created_at")
    private LocalDateTime createdAt;
    
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Integer getUserId() { return userId; }
    public void setUserId(Integer userId) { this.userId = userId; }
    public Integer getFriendId() { return friendId; }
    public void setFriendId(Integer friendId) { this.friendId = friendId; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
