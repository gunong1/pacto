package expo.modules.pactocrashlog

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/** 앱 시작 때(Application.onCreate) 처리되지 않은 예외 처리기를 끼워 넣는다 — 기록만 하고 원래 처리기로 넘긴다 (동작은 바꾸지 않음) */
class PactoCrashLogPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> =
    listOf(object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
          try {
            CrashFile.file(application).writeText(CrashFile.describe(thread, error))
          } catch (_: Throwable) {
            // 기록 실패는 무시
          }
          previous?.uncaughtException(thread, error)
        }
        // 앱 실행 흐름(Activity·task) 기록 — 진단용
        try {
          LifecycleLog.install(application)
        } catch (_: Throwable) {
          // 기록 장치 실패는 무시
        }
      }
    })
}
