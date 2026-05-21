package com.alanya.model;

import jakarta.persistence.*;

@Entity
@Table(name = "pays")
public class Pays {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "idPays")
    private Integer id;

    @Column(name = "libelle", length = 100)
    private String libelle;

    @Column(name = "prefix", length = 4)
    private String prefix;

    @Column(name = "timeZone", length = 100)
    private String timeZone;

    @Column(name = "decalageHoraire")
    private Integer decalageHoraire;

    public Integer getId() { return id; }
    public void setId(Integer id) { this.id = id; }
    public String getLibelle() { return libelle; }
    public void setLibelle(String libelle) { this.libelle = libelle; }
    public String getPrefix() { return prefix; }
    public void setPrefix(String prefix) { this.prefix = prefix; }
    public String getTimeZone() { return timeZone; }
    public void setTimeZone(String timeZone) { this.timeZone = timeZone; }
    public Integer getDecalageHoraire() { return decalageHoraire; }
    public void setDecalageHoraire(Integer decalageHoraire) { this.decalageHoraire = decalageHoraire; }
}
