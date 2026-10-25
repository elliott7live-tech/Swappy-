import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { getFirebaseUpgradeUrl, isQuotaExceededError } from '../firebase';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  isQuota: boolean;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
      isQuota: false,
    };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const rawMsg = error instanceof Error ? error.message : String(error);
    return {
      hasError: true,
      errorMessage: rawMsg,
      isQuota: isQuotaExceededError(error),
    };
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-dvh w-full bg-[#0A0A0C] text-white flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl bg-[#141418] border border-white/10 p-6 space-y-4">
          <div className="w-11 h-11 rounded-2xl bg-[#FE2C55]/15 flex items-center justify-center text-[#FE2C55]">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold">
            {this.state.isQuota
              ? 'Przekroczono dzienny limit bazy danych'
              : 'Wystąpił nieoczekiwany problem'}
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            {this.state.isQuota
              ? 'Dzienny darmowy limit odczytów/zapisów Firestore został wyczerpany i odnowi się jutro.'
              : 'Odśwież aplikację Swappy, aby wznowić przeglądanie filmów.'}
          </p>
          {this.state.isQuota && (
            <a
              href={getFirebaseUpgradeUrl()}
              target="_blank"
              rel="noreferrer"
              className="block text-xs text-[#25F4EE] underline break-all"
            >
              Zarządzaj planem bazy danych w konsoli Firebase
            </a>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full min-h-[46px] rounded-xl bg-[#FE2C55] hover:bg-[#e6254b] text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Uruchom ponownie Swappy</span>
          </button>
        </div>
      </div>
    );
  }
}
