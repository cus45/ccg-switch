import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./i18n";
import App from "./App";

// 仅用量统计走 react-query（需要轮询与缓存失效），其余状态仍用 Zustand
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 用量数据变化快，重取比读缓存更有价值
      staleTime: 0,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
