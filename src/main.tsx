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
import CallRoomPage from "../app/(protected)/calls/[callId]/call"
import CallsPage from "../app/(protected)/calls/calls"
import NewCallPage from "../app/(protected)/calls/new-call"
import ProtectedLayout from "../app/(protected)/layout"
import AiAssistantPage from "../app/(protected)/ai/ai"
import ForgotPasswordPage from "../app/(auth)/forgot-password/forgot-password"
import SignUpPage from "../app/(auth)/signup/signup"
import WelcomePage from "../app/(public)/welcome/welcome"
import NotFoundPage from "../app/(public)/not-found/not-found"
import SettingsPage from "../app/(protected)/settings/settings"
import NewChatPage from "../app/(protected)/chats/new/new-chat"
import ConvInfoPage from "../app/(protected)/chats/[chatId]/chat-info"
import ChatsSplit, { ChatEmptyState } from "../app/(protected)/chats/chats-split"
import SectionSplit from "../app/(protected)/section-split"
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

              {/* L'ecran d'accueil est la liste des discussions, comme sur mobile. */}
              <Route path="/dashboard" element={<Navigate to="/chats" replace />} />
              <Route
                path="/ai"
                element={
                  <ProtectedRoute>
                    <ProtectedLayout>
                      <AiAssistantPage />
                    </ProtectedLayout>
                  </ProtectedRoute>
                }
              />
              {/* Nouveau chat et fiche info : plein ecran (hors vue deux colonnes) */}
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
                path="/chats/:chatId/info"
                element={
                  <ProtectedRoute>
                    <ProtectedLayout>
                      <ConvInfoPage />
                    </ProtectedLayout>
                  </ProtectedRoute>
                }
              />
              {/* Vue deux colonnes facon WhatsApp Web : liste (persistante) + conversation.
                  Le routage imbrique garde la liste montee quand on change de conversation. */}
              <Route
                path="/chats"
                element={
                  <ProtectedRoute>
                    <ProtectedLayout>
                      <ChatsSplit />
                    </ProtectedLayout>
                  </ProtectedRoute>
                }
              >
                <Route index element={<ChatEmptyState />} />
                <Route path=":chatId" element={<ChatRoomPage />} />
              </Route>

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
                      <SectionSplit
                        title="Statuts"
                        subtitle="Selectionnez un statut a gauche, ou publiez le votre pour vos contacts."
                        icon={
                          <svg
                            width="34"
                            height="34"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          >
                            <circle cx="12" cy="12" r="9" strokeDasharray="4 3" />
                            <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
                          </svg>
                        }
                      >
                        <StatusPage />
                      </SectionSplit>
                    </ProtectedLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/calls"
                element={
                  <ProtectedRoute>
                    <ProtectedLayout>
                      <SectionSplit
                        title="Appels"
                        subtitle="Passez un appel audio ou video depuis vos contacts, ou rappelez depuis l'historique."
                        icon={
                          <svg
                            width="34"
                            height="34"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          >
                            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                          </svg>
                        }
                      >
                        <CallsPage />
                      </SectionSplit>
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
