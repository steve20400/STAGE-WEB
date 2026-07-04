import React from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { AuthProvider } from "./components/auth-provider"
import { ProtectedRoute, PublicOnlyRoute } from "./components/route-guards"
import { ThemeProvider } from "./components/theme-provider"
import { ToastProvider } from "./components/toast"
import "./styles/globals.css"
import LoginPage from "../app/(auth)/login/login"
import ChatRoomPage from "../app/(protected)/chats/[chatId]/chat"
import ChatsPage from "../app/(protected)/chats/chats"
import CallRoomPage from "../app/(protected)/calls/[callId]/call"
import CallsPage from "../app/(protected)/calls/calls"
import NewCallPage from "../app/(protected)/calls/new-call"
import ProtectedLayout from "../app/(protected)/layout"
import DashboardPage from "../app/(protected)/dashboard/dashboard"
import ForgotPasswordPage from "../app/(auth)/forgot-password/forgot-password"
import SignUpPage from "../app/(auth)/signup/signup"
import WelcomePage from "../app/(public)/welcome/welcome"
import NotFoundPage from "../app/(public)/not-found/not-found"
import SettingsPage from "../app/(protected)/settings/settings"
import NewChatPage from "../app/(protected)/chats/new/new-chat"
import ConvInfoPage from "../app/(protected)/chats/[chatId]/chat-info"
import ContactsPage from "../app/(protected)/contacts/contacts"
import StatusPage from "../app/(protected)/status/status"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/" element={<WelcomePage />} />
              <Route path="/welcome" element={<WelcomePage />} />
              <Route
                path="/login"
                element={
                  <PublicOnlyRoute>
                    <LoginPage />
                  </PublicOnlyRoute>
                }
              />
              <Route
                path="/signup"
                element={
                  <PublicOnlyRoute>
                    <SignUpPage />
                  </PublicOnlyRoute>
                }
              />
              <Route
                path="/sign-in"
                element={
                  <PublicOnlyRoute>
                    <Navigate to="/signup" replace />
                  </PublicOnlyRoute>
                }
              />
              <Route
                path="/forgot-password"
                element={
                  <PublicOnlyRoute>
                    <ForgotPasswordPage />
                  </PublicOnlyRoute>
                }
              />

              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <ProtectedLayout>
                      <DashboardPage />
                    </ProtectedLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/chats"
                element={
                  <ProtectedRoute>
                    <ProtectedLayout>
                      <ChatsPage />
                    </ProtectedLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/chats/new"
                element={
                  <ProtectedRoute>
                    <ProtectedLayout>
                      <NewChatPage />
                    </ProtectedLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/chats/:chatId"
                element={
                  <ProtectedRoute>
                    <ProtectedLayout>
                      <ChatRoomPage />
                    </ProtectedLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/chats/:chatId/info"
                element={
                  <ProtectedRoute>
                    <ProtectedLayout>
                      <ConvInfoPage />
                    </ProtectedLayout>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/contacts"
                element={
                  <ProtectedRoute>
                    <ProtectedLayout>
                      <ContactsPage />
                    </ProtectedLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/status"
                element={
                  <ProtectedRoute>
                    <ProtectedLayout>
                      <StatusPage />
                    </ProtectedLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/calls"
                element={
                  <ProtectedRoute>
                    <ProtectedLayout>
                      <CallsPage />
                    </ProtectedLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/calls/new"
                element={
                  <ProtectedRoute>
                    <ProtectedLayout>
                      <NewCallPage />
                    </ProtectedLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/calls/:callId"
                element={
                  <ProtectedRoute>
                    <ProtectedLayout>
                      <CallRoomPage />
                    </ProtectedLayout>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <ProtectedLayout>
                      <SettingsPage />
                    </ProtectedLayout>
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>
)
