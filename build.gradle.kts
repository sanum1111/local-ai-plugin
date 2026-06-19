plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "1.9.24"
    id("org.jetbrains.intellij.platform") version "2.1.0"
}

group = "com.localai"
version = "1.0.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
        tasks.patchPluginXml {
            // Вказуємо, що плагін сумісний з будь-якою версією WebStorm
            sinceBuild.set("242")
            untilBuild.set("262.*") // 262.* охоплює твій білд 261
        }
    }
}

dependencies {
    intellijPlatform {
        // Використовуємо 2024.2 або 2024.3, бо вони мають повну підтримку плагіна 2.1.0
        webstorm("2024.2.4")
        instrumentationTools()
    }
}