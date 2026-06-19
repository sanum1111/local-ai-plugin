package com.localai.plugin

import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.OSProcessHandler
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.util.ui.UIUtil
import java.io.File
import java.net.ServerSocket

class LocalAiToolWindowFactory : ToolWindowFactory {

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val projectPath = project.basePath
        if (projectPath == null) {
            val browser = JBCefBrowser()
            browser.loadHTML("<h1>Помилка: не вдалося визначити шлях до проєкту</h1>")
            toolWindow.contentManager.addContent(ContentFactory.getInstance().createContent(browser.component, "", false))
            return
        }

        // 1. Динамічно запитуємо у системи вільний порт
        val apiPort = findFreePort()

        // 2. Автономний запуск фонового Node.js сервера із передачею порту
        val nodeProcessHandler = startNodeServer(projectPath, apiPort)

        // 3. Ініціалізація автономного UI з підтримкою теми IDE та інжекцією порту
        val browser = JBCefBrowser()
        var htmlContent = javaClass.getResource("/webview/index.html")?.readText()

        if (htmlContent != null) {
            // Визначаємо, яка тема увімкнена у WebStorm (Darcula/Dark чи Light)
            val isDarkTheme = UIUtil.isUnderDarcula()
            val themeClass = if (isDarkTheme) "dark-theme" else "light-theme"

            // Підбираємо базові кольори відповідно до теми WebStorm, щоб уникнути білих спалахів/екранів
            val bgColor = if (isDarkTheme) "#1e1e1e" else "#ffffff"
            val textColor = if (isDarkTheme) "#afb1b3" else "#000000"

            // Впорскуємо класи та стилі прямо в тег <body> на льоту
            val bodyReplacement = "<body class=\"$themeClass\" style=\"background-color: $bgColor; color: $textColor; margin: 0; padding: 0;\""
            htmlContent = htmlContent.replace("<body", bodyReplacement)

            // БРОНЕБІЙНА ІНЖЕКЦІЯ ПОРТУ: Створюємо JS-скрипт із портом і вставляємо його перед </head>
            val scriptInjection = "\n<script>window.API_PORT = $apiPort;</script>\n"
            htmlContent = if (htmlContent.contains("</head>")) {
                htmlContent.replace("</head>", "$scriptInjection</head>")
            } else {
                htmlContent.replace(bodyReplacement, "$bodyReplacement$scriptInjection")
            }

            browser.loadHTML(htmlContent)
        } else {
            browser.loadHTML("<h1>Помилка: файл /webview/index.html не знайдено в ресурсах плагіна</h1>")
        }

        val content = ContentFactory.getInstance().createContent(browser.component, "", false)
        toolWindow.contentManager.addContent(content)

        // 4. Жорстка прив'язка життєвого циклу процесу Node.js до вікна плагіна
        if (nodeProcessHandler != null) {
            Disposer.register(toolWindow.disposable) {
                nodeProcessHandler.destroyProcess()
                println("[IntelliJ Bridge] Node.js server stopped on port $apiPort for project: $projectPath")
            }
        }
    }

    // Надійний спосіб знайти вільний порт у Windows/Unix системі
    private fun findFreePort(): Int {
        return try {
            ServerSocket(0).use { socket ->
                socket.localPort
            }
        } catch (e: Exception) {
            e.printStackTrace()
            4567 // Безпечний дефолтний фолбек, якщо сокети заблоковані
        }
    }

    private fun startNodeServer(projectPath: String, port: Int): OSProcessHandler? {
        try {
            // 1. Створюємо або знаходимо тимчасову папку для сервера
            val tempDir = File(System.getProperty("java.io.tmpdir"), "local-ai-bridge-server")
            if (!tempDir.exists()) {
                tempDir.mkdirs()
            }

            val serverFile = File(tempDir, "server.js")

            // 2. Копіюємо server.js з JAR-ресурсів на диск
            javaClass.classLoader.getResourceAsStream("webview/server.js").use { inputStream ->
                if (inputStream == null) {
                    println("[IntelliJ Bridge] Помилка: server.js не знайдено в ресурсах!")
                    return null
                }
                serverFile.outputStream().use { outputStream ->
                    inputStream.copyTo(outputStream)
                }
            }

            // 3. Запускаємо Node.js процес із передачею ПОРТУ як 4-го аргументу (index 3)
            val commandLine = GeneralCommandLine("node", serverFile.absolutePath, projectPath, port.toString())
            commandLine.withWorkDirectory(projectPath)

            val handler = OSProcessHandler(commandLine)
            handler.startNotify()

            println("[IntelliJ Bridge] Node.js server successfully extracted and started from: ${serverFile.absolutePath}")
            println("[IntelliJ Bridge] Root directory locked to: $projectPath")
            println("[IntelliJ Bridge] Server successfully assigned to dynamic port: $port")

            return handler
        } catch (e: Exception) {
            e.printStackTrace()
            return null
        }
    }
}