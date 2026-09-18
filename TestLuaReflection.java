
import java.io.*;
import java.lang.reflect.*;
import se.krka.kahlua.vm.*;
import zombie.Lua.*;

public class TestLuaReflection {
    public static void main(String[] args) {
        try {
            // Check if OutfitManager can be found in LuaManager.env
            // or if any outfit manager class is in env
            KahluaPlatform platform = (KahluaPlatform) Class.forName("se.krka.kahlua.j2se.J2SEPlatform").newInstance();
            System.out.println("Platform loaded");
        } catch (Throwable t) {
            t.printStackTrace();
        }
    }
}
