package com.alanya.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/**
 * Appel/reunion de groupe (room WebRTC).
 */
@Entity
@Table(name = "meeting")
public class Meeting {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "idMeeting")
    private Long id;

    @Column(name = "idOrganiser", nullable = false)
    private Integer organiserId;

    @Column(name = "start_time")
    private LocalDateTime startTime;

    @Column(name = "duree")
    private Integer duration;

    @Column(name = "objet", length = 255)
    private String objet;

    @Column(name = "room", length = 100)
    private String room;

    @Column(name = "isEnd")
    private Boolean isEnd = false;

    @Column(name = "type_media")
    private Boolean typeMedia = false;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Integer getOrganiserId() { return organiserId; }
    public void setOrganiserId(Integer organiserId) { this.organiserId = organiserId; }
    public LocalDateTime getStartTime() { return startTime; }
    public void setStartTime(LocalDateTime startTime) { this.startTime = startTime; }
    public Integer getDuration() { return duration; }
    public void setDuration(Integer duration) { this.duration = duration; }
    public String getObjet() { return objet; }
    public void setObjet(String objet) { this.objet = objet; }
    public String getRoom() { return room; }
    public void setRoom(String room) { this.room = room; }
    public Boolean getIsEnd() { return isEnd; }
    public void setIsEnd(Boolean isEnd) { this.isEnd = isEnd; }
    public Boolean getTypeMedia() { return typeMedia; }
    public void setTypeMedia(Boolean typeMedia) { this.typeMedia = typeMedia; }
}
