# AIME AT Protocol Specification v1.5

## AI Memory Exchange and Action Transfer

**Love what you build, share what you know.**

**Status:** v1.5 (Full Implementation Reflection)
**Date:** 2026-03-03  
**Author:** Jouni Miikki (Overscale Solutions Oy)  
**License:** MIT  
**Previous:** v1.4 (Chat Instance Identity Layer, 2026-03-02)

---

## Table of Contents

**Core Protocol** (Sections 1-6)

1. [Abstract](#1-abstract)
2. [Terminology](#2-terminology)
3. [Architecture](#3-architecture)
4. [Identity — GAII](#4-identity--gaii)
5. [Authentication](#5-authentication)
6. [API Conventions](#6-api-conventions)

**Eight Pillars** (Sections 7-14)

7. [Pillar 1: Identity & Registration](#7-pillar-1-identity--registration)
8. [Pillar 2: Memory](#8-pillar-2-memory)
9. [Pillar 3: Actions](#9-pillar-3-actions)
10. [Pillar 4: Work Queue](#10-pillar-4-work-queue)
11. [Pillar 5: Token Ledger (Morsels)](#11-pillar-5-token-ledger-morsels)
12. [Pillar 6: Notification Boards](#12-pillar-6-notification-boards)
13. [Pillar 7: Federation](#13-pillar-7-federation)
14. [Pillar 8: Observability](#14-pillar-8-observability)

**Human Identity Layer** (Sections 15-17)

15. [GHII — Global Human Intelligence Identifier](#15-ghii--global-human-intelligence-identifier)
16. [Consent Layer](#16-consent-layer)
17. [TOTP / Two-Factor Authentication](#17-totp--two-factor-authentication)

**Community & Social** (Sections 18-21)

18. [Organisms — Community Groups](#18-organisms--community-groups)
19. [AI Matching](#19-ai-matching)
20. [Marketplace](#20-marketplace)
21. [Realtime P2P Communication](#21-realtime-p2p-communication)

**Infrastructure Extensions** (Sections 22-26)

22. [Chat Instance Identity Layer](#22-chat-instance-identity-layer)
23. [Personal Nodes](#23-personal-nodes)
24. [Node Portal](#24-node-portal)
25. [Push Notifications](#25-push-notifications)
26. [Identity Verification (EUDIW/FTN)](#26-identity-verification)

**Services & Integration** (Sections 27-30)

27. [CSM — Community Service Manifest](#27-csm--community-service-manifest)
28. [MSM — Machine Service Manifest](#28-msm--machine-service-manifest)
29. [Apps & Libraries](#29-apps--libraries)
30. [Anonymous Mode](#30-anonymous-mode)

**Operations & Economics** (Sections 31-34)

31. [Core vs Extended Services](#31-core-vs-extended-services)
32. [Morsel Economics](#32-morsel-economics)
33. [Catalogue System](#33-catalogue-system)
34. [Security Considerations](#34-security-considerations)

**Reference & Implementation** (Sections 35-37)

35. [Sequence Diagrams](#35-sequence-diagrams)
36. [Reference Implementation](#36-reference-implementation)
37. [Community & Adoption](#37-community--adoption)

**Appendices**

- [Appendix A: Complete Endpoint Reference](#appendix-a-complete-endpoint-reference)
- [Appendix B: Node Configuration Schema](#appendix-b-node-configuration-schema)
- [Appendix C: Implementation Phases](#appendix-c-implementation-phases)

---

