# Neighbourly – Stage 3 (FINAL)
**Location-Based Provider–Seeker Platform**

---

## 📌 Project Description
Neighbourly is a web-based service marketplace that connects **Seekers** (users searching for services) with **Providers** (users offering services) based on geographical proximity.  
The platform supports role-based dashboards, real-time one-to-one communication, and efficient location-based service discovery.

This project focuses on building a scalable and extensible foundation that can evolve into a full-scale production system in later stages.

---

## 🧠 Design Decisions

### Backend Technology – Supabase
Supabase was selected as the backend because it provides PostgreSQL, REST APIs, and real-time data subscriptions in a single platform. This minimizes backend complexity while ensuring scalability, data consistency, and support for real-time features such as chat.

### Frontend Technology – HTML, CSS, JavaScript
Vanilla HTML, CSS, and JavaScript were used to keep the frontend lightweight, understandable, and framework-independent. This choice allows easy migration to modern frontend frameworks (React, Angular, etc.) in future stages without changing the backend architecture.

### Realtime Chat Design
Instead of maintaining a separate conversations table, a deterministic `conversation_id` is generated using Provider and Seeker IDs. This simplifies the data model, avoids redundant lookups, and guarantees consistent chat access for both participants.

### Location-Based Discovery – Uber H3
Uber’s H3 geospatial indexing system was chosen to implement radius-based discovery. H3 provides efficient spatial indexing and scales better than basic coordinate distance calculations, making it suitable for future expansion.

---

## 🗂️ Data Model

### Core Tables

**users**
- id
- role (provider / seeker)
- name
- created_at

**services**
- id
- provider_id
- title
- latitude
- longitude
- h3_index
- created_at

**chat_messages**
- id
- conversation_id
- seeker_id
- provider_id
- sender_id
- sender_name
- content
- created_at

### Schema Overview

```text
User (Provider) ──┐
                  ├── Service (Latitude, Longitude, H3 Index)
User (Seeker)  ───┘

User (Seeker) ──┐
                 ├── Chat_Message (conversation_id)
User (Provider) ─┘

## 🔄 Evolution Rationale (Stage 1 → Stage 3)

The Stage 1 design establishes clear role separation and modular frontend logic, making the system easy to extend.  
Stage 2 builds on this foundation by introducing real-time chat and H3-based geospatial discovery without altering the core architecture.

This layered design ensures that Stage 3 can introduce advanced features such as analytics, fine-grained authorization, service clustering, and mobile support with minimal refactoring.

---

## ⚙️ Assumptions

### Business Assumptions
- Each service interaction involves one Provider and one Seeker.
- Users operate in a single role at any given time.
- Services are location-fixed and not dynamically moving.

### Technical Assumptions
- Supabase Realtime provides acceptable latency for messaging.
- Browser-provided geolocation is sufficiently accurate.
- Uber H3 resolution is chosen to balance precision and performance.
- Advanced authentication and authorization will be implemented in later stages.

---

## ✅ Conclusion
The Neighbourly platform is designed to be simple, scalable, and extensible.  
The architectural decisions made in Stage 2 ensure that the system not only meets current functional requirements but also provides a strong foundation for future enhancements in Stage 3 and beyond.
