package com.alanya.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "users")
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "alanyaID")
    private Integer id;
    
    @Column(name = "nom", nullable = false, length = 60)
    private String name;
    
    @Column(name = "alanyaPhone", nullable = false, unique = true, length = 20)
    private String phone;
    
    @Column(name = "email", unique = true)
    private String email;
    
    @Column(name = "password", nullable = false)
    private String password;
    
    @Column(name = "avatar_url", length = 255)
    private String avatarUrl;
    
    @Column(name = "is_online")
    private Boolean isOnline = false;
    
    @Column(name = "last_seen")
    private LocalDateTime lastSeen;
    
    @Column(name = "status_msg", length = 100)
    private String statusMsg = "Disponible";
    
    @Column(name = "created_at")
    private LocalDateTime createdAt;
    
    // Getters
    public Integer getId() { return id; }
    public String getName() { return name; }
    public String getPhone() { return phone; }
    public String getEmail() { return email; }
    public String getPassword() { return password; }
    public String getAvatarUrl() { return avatarUrl; }
    public Boolean getIsOnline() { return isOnline; }
    public LocalDateTime getLastSeen() { return lastSeen; }
    public String getStatusMsg() { return statusMsg; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    
    // Setters
    public void setId(Integer id) { this.id = id; }
    public void setName(String name) { this.name = name; }
    public void setPhone(String phone) { this.phone = phone; }
    public void setEmail(String email) { this.email = email; }
    public void setPassword(String password) { this.password = password; }
    public void setAvatarUrl(String avatarUrl) { this.avatarUrl = avatarUrl; }
    public void setIsOnline(Boolean isOnline) { this.isOnline = isOnline; }
    public void setLastSeen(LocalDateTime lastSeen) { this.lastSeen = lastSeen; }
    public void setStatusMsg(String statusMsg) { this.statusMsg = statusMsg; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
