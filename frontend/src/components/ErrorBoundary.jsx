import { Component } from 'react';
import { ErrorState } from '@/components/States';

// Si un componente falla al renderizar, se muestra un mensaje en vez de una pantalla en blanco.
export class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Error de interfaz:', error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="py-10">
        <ErrorState title="Algo salió mal en esta pantalla" message="Ya registramos el error. Puedes volver a intentarlo o recargar la página." onRetry={() => this.setState({ error: null })} />
      </div>
    );
  }
}
