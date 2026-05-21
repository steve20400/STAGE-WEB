package com.alanya.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/**
 * Historique des connexions (device, IP, OS).
 */
@Entity
@Table(name = "access_alanya")
public class UserAccess {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "idLogin")
    private Long id;

    @Column(name = "alanyaID", nullable = false)
    private Integer userId;

    @Column(name = "device", length = 255)
    private String device;

    @Column(name = "dateLogin")
    private LocalDateTime dateLogin;

    @Column(name = "ipAddress", length = 255)
    private String ipAddress;

    @Column(name = "os_system", length = 255)
    private String osSystem;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Integer getUserId() { return userId; }
    public void setUserId(Integer userId) { this.userId = userId; }
    public String getDevice() { return device; }
    public void setDevice(String device) { this.device = device; }
    public LocalDateTime getDateLogin() { return dateLogin; }
    public void setDateLogin(LocalDateTime dateLogin) { this.dateLogin = dateLogin; }
    public String getIpAddress() { return ipAddress; }
    public void setIpAddress(String ipAddress) { this.ipAddress = ipAddress; }
    public String getOsSystem() { return osSystem; }
    public void setOsSystem(String osSystem) { this.osSystem = osSystem; }
}
