package com.alanya.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "blocked")
public class Blocked {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "idBlock")
    private Long id;

    @Column(name = "alanyaID", nullable = false)
    private Integer userId;

    @Column(name = "idCallerBlock", nullable = false)
    private Integer blockedUserId;

    @Column(name = "dateBlock")
    private LocalDateTime dateBlock;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Integer getUserId() { return userId; }
    public void setUserId(Integer userId) { this.userId = userId; }
    public Integer getBlockedUserId() { return blockedUserId; }
    public void setBlockedUserId(Integer blockedUserId) { this.blockedUserId = blockedUserId; }
    public LocalDateTime getDateBlock() { return dateBlock; }
    public void setDateBlock(LocalDateTime dateBlock) { this.dateBlock = dateBlock; }
}
