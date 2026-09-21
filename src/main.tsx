import React, { Component, ErrorInfo, ReactNode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class RootErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("React 根组件未捕获异常:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "32px", fontFamily: "sans-serif", background: "#f8fafc", color: "#0f172a", minHeight: "100vh" }}>
          <h2 style={{ fontSize: "18px", fontWeight: "bold", color: "#e11d48", marginBottom: "12px" }}>
            看板界面加载遇到问题
          </h2>
          <p style={{ fontSize: "13px", color: "#64748b", marginBottom: "16px" }}>
            错误详情: {this.state.error?.message || "未知异常"}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: "8px 16px", borderRadius: "8px", background: "#0284c7", color: "#fff", border: "none", cursor: "pointer", fontSize: "13px" }}
          >
            重新加载界面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>,
);
