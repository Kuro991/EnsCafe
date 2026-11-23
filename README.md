# EnsCafe ☕

Plataforma web social para explorar, descubrir y reseñar cafeterías en **Ensenada, Baja California**, inspirada en dinámicas de curaduría y listas de favoritos estilo *Letterboxd*.

---

## 📋 Descripción General

**EnsCafe** permite a los amantes del café descubrir locales en Ensenada mediante un catálogo interactivo y mapas geolocalizados, calificar su experiencia, publicar reseñas detalladas, organizar sus cafeterías favoritas en listas personales y gestionar el catálogo desde un panel administrativo.

El proyecto está estructurado como un **monorepo** gestionado con `pnpm workspaces`, separando una aplicación frontend moderna de una arquitectura backend orientada a microservicios independientes con almacenamiento ligero en SQLite.

---

## ✨ Características Principales

* **Exploración y Catálogo:** Búsqueda y filtrado de cafeterías locales con vista de detalle (`Explore`, `CafeDetail`).
* **Mapa Interactivo:** Visualización geográfica de cafeterías en Ensenada utilizando **Leaflet** (`CafeMap`, `MapPage`)[cite: 1].
* **Sistema de Reseñas y Calificaciones:** Evaluación por estrellas (`StarRating`) y publicación de reseñas por usuario[cite: 1].
* **Rankings y Perfiles:** Sección de cafeterías destacadas (`Top`) y perfil personal de actividad y favoritos (`Profile`)[cite: 1].
* **Autenticación y Administración:** Registro/inicio de sesión de usuarios (`AuthPage`) y panel de gestión (`Admin`)[cite: 1].

---

## 🛠️ Stack Tecnológico

### Frontend
* **Framework:** React + Vite[cite: 1]
* **Estilos y UI:** Tailwind CSS, componentes modulares (`ui/`), `class-variance-authority`, `clsx` e iconos con `lucide-react`[cite: 1]
* **Mapas:** Leaflet[cite: 1]

### Backend & Arquitectura
* **Gestor de Monorepo:** `pnpm` (`pnpm-workspace.yaml`)[cite: 1]
* **Microservicios (Node.js):**
  * `gateway`: Punto de entrada y enrutamiento de peticiones hacia los servicios internos[cite: 1].
  * `auth`: Gestión de usuarios, sesiones y autenticación[cite: 1].
  * `catalog`: Administración del catálogo de cafeterías y datos iniciales (`seed.js`)[cite: 1].
  * `reviews`: Gestión de reseñas y calificaciones[cite: 1].
* **Base de Datos:** SQLite (`auth.db`, `catalog.db`, `reviews.db`) con persistencia aislada por servicio[cite: 1].

---

## 📂 Estructura del Proyecto

```text
enscafe/
├── data/                       # Bases de datos SQLite por microservicio (auth, catalog, reviews)
├── frontend/                   # Aplicación cliente en React + Vite + Tailwind CSS
│   └── src/
│       ├── auth/               # Contexto de autenticación (AuthContext)
│       ├── components/         # Componentes reutilizables (CafeCard, CafeMap, StarRating, UI)
│       ├── lib/                # Utilidades, cliente API y custom hooks
│       └── pages/              # Vistas principales (Home, Explore, MapPage, CafeDetail, Top, Profile, Admin, AuthPage)
├── packages/
│   └── common/                 # Utilidades y configuraciones compartidas entre servicios
├── services/
│   ├── auth/                   # Microservicio de autenticación
│   ├── catalog/                # Microservicio de cafeterías + script seed.js
│   ├── gateway/                # API Gateway
│   └── reviews/                # Microservicio de reseñas
├── .env.example                # Plantilla de variables de entorno
├── package.json                # Scripts globales del monorepo
└── pnpm-workspace.yaml         # Definición de workspaces
```[cite: 1]

---

## 🚀 Instalación y Ejecución Local

### Prerrequisitos
* **Node.js** (v18 o superior recomendado)
* **pnpm** instalado globalmente (`npm install -g pnpm`)

### 1. Clonar el repositorio e instalar dependencias
```bash
git clone [https://github.com/Kuro991/EnsCafe.git](https://github.com/Kuro991/EnsCafe.git)
cd EnsCafe
pnpm install
```[cite: 1]

### 2. Configurar variables de entorno
Crea un archivo `.env` en la raíz del proyecto a partir de la plantilla incluida:
```bash
cp .env.example .env