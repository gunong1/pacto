import { Component, type ReactNode } from 'react';

/** 뷰어 화면 안의 렌더링 오류를 잡아 앱 전체가 종료되지 않게 한다 (오류 이름만 알린다 — 메시지·주소 없음) */
export class ViewerErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onError: (name: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error instanceof Error ? error.name : 'unknown');
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
