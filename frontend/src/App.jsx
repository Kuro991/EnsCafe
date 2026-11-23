import { Route, Routes } from 'react-router-dom';
import Layout from '@/components/Layout';
import { RequireAuth } from '@/auth/AuthContext';
import Home from '@/pages/Home';
import Explore from '@/pages/Explore';
import MapPage from '@/pages/MapPage';
import CafeDetail from '@/pages/CafeDetail';
import AuthPage from '@/pages/AuthPage';
import Profile from '@/pages/Profile';
import Top from '@/pages/Top';
import Admin from '@/pages/Admin';
import NotFound from '@/pages/NotFound';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="explorar" element={<Explore />} />
        <Route path="mapa" element={<MapPage />} />
        <Route path="cafeteria/:id" element={<CafeDetail />} />
        <Route path="top" element={<Top />} />
        <Route path="acceso" element={<AuthPage mode="login" />} />
        <Route path="registro" element={<AuthPage mode="register" />} />
        <Route path="perfil" element={<RequireAuth><Profile /></RequireAuth>} />
        <Route path="admin" element={<RequireAuth admin><Admin /></RequireAuth>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
