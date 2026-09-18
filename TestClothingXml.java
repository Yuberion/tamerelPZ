
import java.io.*;
import zombie.core.skinnedmodel.population.*;
import zombie.util.*;

public class TestClothingXml {
    public static void main(String[] args) {
        try {
            File f = new File("E:/REMOD_Port/42/media/clothing/clothing.xml");
            System.out.println("File exists: " + f.exists() + ", path: " + f.getAbsolutePath());
            OutfitManager mgr = (OutfitManager) PZXmlUtil.parse(OutfitManager.class, f.getAbsolutePath());
            if (mgr == null) {
                System.out.println("OutfitManager is NULL!");
            } else {
                System.out.println("Male outfits: " + (mgr.maleOutfits != null ? mgr.maleOutfits.size() : "null"));
                if (mgr.maleOutfits != null) {
                    for (Outfit o : mgr.maleOutfits) System.out.println("  Male: " + o.name);
                }
                System.out.println("Female outfits: " + (mgr.femaleOutfits != null ? mgr.femaleOutfits.size() : "null"));
                if (mgr.femaleOutfits != null) {
                    for (Outfit o : mgr.femaleOutfits) System.out.println("  Female: " + o.name);
                }
            }
        } catch (Throwable t) {
            t.printStackTrace();
        }
    }
}
