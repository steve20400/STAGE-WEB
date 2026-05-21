package com.alanya.dto.response;

import java.time.LocalDateTime;

public class UserResponse {
    private Integer id;
    private String name;
    private String phone;
    private String email;
    private String avatar;
    private Boolean isOnline;
    private String statusMsg;
    private LocalDateTime createdAt;

    public UserResponse() {}

    public UserResponse(Integer id, String name, String phone, String email, String avatar, Boolean isOnline, String statusMsg, LocalDateTime createdAt) {
        this.id = id;
        this.name = name;
        this.phone = phone;
        this.email = email;
        this.avatar = avatar;
        this.isOnline = isOnline;
        this.statusMsg = statusMsg;
        this.createdAt = createdAt;
    }

    public Integer getId() { return id; }
    public String getName() { return name; }
    public String getPhone() { return phone; }
    public String getEmail() { return email; }
    public String getAvatar() { return avatar; }
    public Boolean getIsOnline() { return isOnline; }
    public String getStatusMsg() { return statusMsg; }
    public LocalDateTime getCreatedAt() { return createdAt; }

    public void setId(Integer id) { this.id = id; }
    public void setName(String name) { this.name = name; }
    public void setPhone(String phone) { this.phone = phone; }
    public void setEmail(String email) { this.email = email; }
    public void setAvatar(String avatar) { this.avatar = avatar; }
    public void setIsOnline(Boolean isOnline) { this.isOnline = isOnline; }
    public void setStatusMsg(String statusMsg) { this.statusMsg = statusMsg; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
