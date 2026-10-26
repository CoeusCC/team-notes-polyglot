package notes;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class ValidationTest {
    @Test void trimsUnicodeWhiteSpaceNotZwspOrBom() {
        assertEquals("hi", Main.trimWs(" hi　"));
        assertEquals("​", Main.trimWs("​"));
        assertEquals("﻿", Main.trimWs("﻿"));
        assertEquals("", Main.trimWs("  "));
    }
    @Test void countsCodePoints() {
        assertEquals(2, Main.cps("é"));
        assertEquals(5, Main.cps("👨‍👩‍👧"));
        assertEquals(1, Main.cps("😀"));
    }
    @Test void detectsLoneSurrogates() {
        assertTrue(Main.lone("\ud800"));
        assertTrue(Main.lone("x\udfff"));
        assertFalse(Main.lone("😀"));
    }
}
