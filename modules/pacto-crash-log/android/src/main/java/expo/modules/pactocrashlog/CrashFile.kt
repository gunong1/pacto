package expo.modules.pactocrashlog

import android.content.Context
import java.io.File

/**
 * 크래시 기록 파일 — 앱 내부 저장소(다른 앱이 읽을 수 없음).
 * 남기는 것: 시각 · 스레드 이름 · 예외 종류 · 짧은 메시지(주소·숫자열 가림) · 코드 위치(클래스.메서드:줄) — 계약서 주소·토큰·내용 없음.
 */
object CrashFile {
  private const val NAME = "pacto-native-crash.txt"
  private val URL = Regex("""(?i)\b(?:https?|file|content|data|blob)://\S+""")
  private val LONG_TOKEN = Regex("""[A-Za-z0-9_\-.%]{24,}""")

  fun file(context: Context): File = File(context.filesDir, NAME)

  fun scrub(s: String?): String =
    (s ?: "").replace(URL, "[url]").replace(LONG_TOKEN, "[…]").take(300)

  fun describe(thread: Thread, error: Throwable): String {
    val sb = StringBuilder()
    sb.append("time=").append(System.currentTimeMillis()).append('\n')
    sb.append("thread=").append(scrub(thread.name)).append('\n')
    var e: Throwable? = error
    var depth = 0
    while (e != null && depth < 5) {
      sb.append(if (depth == 0) "exception=" else "caused_by=").append(e.javaClass.name).append(": ").append(scrub(e.message)).append('\n')
      for (frame in e.stackTrace.take(25)) {
        sb.append("  at ").append(frame.className).append('.').append(frame.methodName).append(':').append(frame.lineNumber).append('\n')
      }
      e = e.cause
      depth++
    }
    return sb.toString()
  }
}
